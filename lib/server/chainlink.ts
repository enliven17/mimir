/**
 * Chainlink price feeds on Ethereum mainnet: a third, independent, keyless
 * price source, and the only one of the three that is itself an on-chain
 * oracle rather than an aggregator's API.
 *
 * Reads go to a public mainnet RPC (CHAINLINK_RPC_URL overrides). Each feed's
 * description() is checked before it is trusted, so a wrong address in the
 * table below fails closed instead of pricing the claim off another asset.
 */
import { createPublicClient, http, parseAbi, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

import type { PriceReading } from "../price-consensus";

/** Verified against description() on mainnet, September 2026. */
export const CHAINLINK_FEEDS: Record<string, `0x${string}`> = {
  BTC: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  ETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  SOL: "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  LINK: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c",
  AVAX: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7",
  MATIC: "0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676",
};

/** A round older than this at the target time is a stale feed, not a price. */
const MAX_ROUND_AGE_S = 26 * 3600;

const FEED_ABI = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

let client: PublicClient | null = null;
function rpc(): PublicClient {
  client ??= createPublicClient({
    chain: mainnet,
    transport: http(process.env.CHAINLINK_RPC_URL?.trim() || "https://ethereum-rpc.publicnode.com", { timeout: 10_000 }),
  }) as PublicClient;
  return client;
}

interface Round {
  answer: bigint;
  updatedAt: number;
}

/**
 * The index of the last round updated at or before `target`, given rounds
 * 1..latest ordered by time. -1 when even the first is later. Pure, so it is
 * tested without a chain.
 */
export async function lastRoundAtOrBefore(
  latest: number,
  target: number,
  updatedAtOf: (index: number) => Promise<number>,
): Promise<number> {
  let lo = 1;
  let hi = latest;
  let found = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await updatedAtOf(mid);
    if (t !== 0 && t <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The feed's price for `symbol`, now or at `atMs`. A Chainlink answer stays
 * valid until the next round (feeds update on deviation or heartbeat), so a
 * historical reading reports the target time itself as its timestamp.
 */
export async function fetchChainlinkPrice(symbol: string, atMs?: number): Promise<PriceReading | null> {
  const address = CHAINLINK_FEEDS[symbol.toUpperCase()];
  if (!address) return null;
  try {
    const c = rpc();
    const [description, decimals, latest] = await Promise.all([
      c.readContract({ address, abi: FEED_ABI, functionName: "description" }),
      c.readContract({ address, abi: FEED_ABI, functionName: "decimals" }),
      c.readContract({ address, abi: FEED_ABI, functionName: "latestRoundData" }),
    ]);
    if (description !== `${symbol.toUpperCase()} / USD`) return null;

    const scale = 10 ** Number(decimals);
    const target = atMs === undefined ? Math.floor(Date.now() / 1000) : Math.floor(atMs / 1000);
    let round: Round = { answer: latest[1], updatedAt: Number(latest[3]) };

    if (round.updatedAt > target) {
      // Round ids are (phase << 64) | index; search this phase for the round
      // that was current at the target time.
      const phase = latest[0] >> 64n;
      const latestIndex = Number(latest[0] & ((1n << 64n) - 1n));
      const cache = new Map<number, Round>();
      const roundAt = async (index: number): Promise<Round> => {
        const hit = cache.get(index);
        if (hit) return hit;
        const r = await c.readContract({
          address, abi: FEED_ABI, functionName: "getRoundData", args: [(phase << 64n) | BigInt(index)],
        }).catch(() => null);
        const value = r ? { answer: r[1], updatedAt: Number(r[3]) } : { answer: 0n, updatedAt: 0 };
        cache.set(index, value);
        return value;
      };
      const index = await lastRoundAtOrBefore(latestIndex, target, async (i) => (await roundAt(i)).updatedAt);
      if (index < 1) return null;
      round = await roundAt(index);
    }

    if (round.answer <= 0n || target - round.updatedAt > MAX_ROUND_AGE_S) return null;
    return {
      source: "chainlink",
      priceUsd: Number(round.answer) / scale,
      at: atMs ?? round.updatedAt * 1000,
    };
  } catch {
    return null;
  }
}
