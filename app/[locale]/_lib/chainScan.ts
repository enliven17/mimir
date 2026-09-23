/**
 * Shared per-chain plumbing for the server pages that read contract history
 * directly (/agents, /stats, /council).
 *
 * Every deployed chain is scanned in parallel and a chain that fails only
 * drops its own rows: an Arbitrum RPC outage must not blank the Arc numbers.
 * Block numbers mean nothing across chains, so rows carry an approximate
 * timestamp (blockClock) for mixed-chain ordering.
 */
import "server-only";
import { erc20Abi } from "viem";
import {
  createChainPublicClient,
  getContractAddress,
  getDeployBlock,
  paginatedGetLogs,
} from "@/lib/arc";
import { enabledChainKeys, getChain, stakeUnitsToUsdc, type ChainKey } from "@/lib/chains";
import { cachedFor } from "@/lib/server/ttl-cache";

// Same topics on the v2 and v3 escrows (checked against lib/mimir-abi.ts and
// lib/mimir-v3-abi.ts), so one filter works on every chain.
export const CLAIM_CREATED_EVENT = {
  type: "event",
  name: "ClaimCreated",
  inputs: [
    { name: "id",       type: "uint256", indexed: true },
    { name: "creator",  type: "address", indexed: true },
    { name: "category", type: "string",  indexed: false },
  ],
} as const;

export const CLAIM_CHALLENGED_EVENT = {
  type: "event",
  name: "ClaimChallenged",
  inputs: [
    { name: "id",         type: "uint256", indexed: true },
    { name: "challenger", type: "address", indexed: true },
    { name: "stake",      type: "uint256", indexed: false },
  ],
} as const;

export const CLAIM_RESOLVED_EVENT = {
  type: "event",
  name: "ClaimResolved",
  inputs: [
    { name: "id",           type: "uint256", indexed: true },
    { name: "winnerSide",   type: "uint8",   indexed: false },
    { name: "summary",      type: "string",  indexed: false },
    { name: "confidence",   type: "uint8",   indexed: false },
    { name: "evidenceHash", type: "bytes32", indexed: false },
  ],
} as const;

type ContractEvent =
  | typeof CLAIM_CREATED_EVENT
  | typeof CLAIM_CHALLENGED_EVENT
  | typeof CLAIM_RESOLVED_EVENT;

/**
 * Run `fn` on every chain with a deployed escrow. Failures are logged under
 * `tag` and leave that chain out; the rest still render.
 */
export async function acrossChains<T>(
  tag: string,
  fn: (chain: ChainKey) => Promise<T>,
): Promise<Array<{ chain: ChainKey; value: Awaited<T> }>> {
  const settled = await Promise.all(
    enabledChainKeys().map(async (chain) => {
      try {
        return { chain, value: await fn(chain) };
      } catch (err) {
        console.error(`[${tag}] ${chain} read failed:`, err);
        return null;
      }
    }),
  );
  return settled.filter((r): r is { chain: ChainKey; value: Awaited<T> } => r !== null);
}

/** Full history of one escrow event on `chain`, oldest first. */
export async function scanEvent(chain: ChainKey, event: ContractEvent): Promise<any[]> {
  return paginatedGetLogs(
    createChainPublicClient(chain),
    { address: getContractAddress(chain), event: event as any },
    getDeployBlock(chain),
  );
}

/**
 * USDC `address` holds on `chain`, in whole USDC. On Arc that is the native
 * balance (USDC is gas); on ERC-20 chains it is the USDC token balance.
 */
export async function usdcBalance(chain: ChainKey, address: `0x${string}`): Promise<number> {
  const cfg = getChain(chain);
  const client = createChainPublicClient(chain);
  if (cfg.stakeMode === "native") {
    return stakeUnitsToUsdc(chain, await client.getBalance({ address }));
  }
  const raw = await client.readContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(raw) / 1_000_000;
}

/** Gas-token balance on ERC-20 chains (ETH), null on Arc where gas is the USDC above. */
export async function gasBalance(chain: ChainKey, address: `0x${string}`): Promise<number | null> {
  if (getChain(chain).stakeMode === "native") return null;
  const wei = await createChainPublicClient(chain).getBalance({ address });
  return Number(wei / 10n ** 12n) / 1_000_000;
}

/** Span used to estimate the block time; far enough to smooth out jitter. */
const CLOCK_SPAN = 10_000n;

async function blockClockUncached(chain: ChainKey): Promise<{ head: number; headTs: number; secPerBlock: number }> {
  const client = createChainPublicClient(chain);
  const head = await client.getBlock({ blockTag: "latest" });
  const pastNumber = head.number > CLOCK_SPAN ? head.number - CLOCK_SPAN : 0n;
  const past = await client.getBlock({ blockNumber: pastNumber });
  const blocks = Number(head.number - past.number);
  const secPerBlock = blocks > 0 ? Number(head.timestamp - past.timestamp) / blocks : 0;
  return { head: Number(head.number), headTs: Number(head.timestamp), secPerBlock };
}

const cachedClock = cachedFor(blockClockUncached, 60_000);

/**
 * Approximate unix seconds for a block on `chain`, from the head and one
 * older header (two reads per chain per minute). Good enough to interleave
 * feeds from different chains; unreadable clocks sort that chain last.
 */
export async function blockClock(chain: ChainKey): Promise<(block: number) => number> {
  try {
    const { head, headTs, secPerBlock } = await cachedClock(chain);
    return (block: number) => Math.round(headTs - (head - block) * secPerBlock);
  } catch (err) {
    console.error(`[chainScan] ${chain} clock failed:`, err);
    return () => 0;
  }
}
