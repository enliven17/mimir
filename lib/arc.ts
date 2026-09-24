/**
 * Arc chain configuration (Circle L1)
 * Chain ID: 5042002 (0x4cef52) — Arc Testnet
 * Native currency: USDC (18 decimals at EVM level) — used for gas AND stakes
 * Note: Arc uses 18 decimals for the native USDC token (like ETH on Ethereum),
 * but displays as 6 significant decimal places in wallets.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  CHAINS,
  arcTestnet,
  getChain,
  requireContractAddress,
  explorerTxUrl,
  explorerAddressUrl,
  type ChainKey,
} from "./chains";

export { arcTestnet };

export const ARC_EXPLORER_URL = CHAINS.arc.explorerUrl;

/** Circle's Gateway Wallet — same address on every Gateway testnet (Arc, Base, Arbitrum). */
export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

// ── RPC endpoint ──────────────────────────────────────────────────────────────
export function getRpcUrl(key: ChainKey = "arc"): string {
  return getChain(key).rpcUrl;
}

export function getArcRpcUrl(): string {
  return getRpcUrl("arc");
}

/** Escrow address on `key`. Arc returns the zero address when unset, as before. */
export function getContractAddress(key: ChainKey = "arc"): `0x${string}` {
  if (key === "arc") {
    return CHAINS.arc.contractAddress ?? "0x0000000000000000000000000000000000000000";
  }
  return requireContractAddress(key);
}

// Arc public RPC enforces `eth_getLogs` ≤ 10,000 blocks per call. We start
// scans from the contract's deploy block and chunk in 10k batches.
export const ARC_LOG_CHUNK = CHAINS.arc.logChunk;
const CHAINS_BY_ID = new Map(Object.values(CHAINS).map((c) => [c.chain.id, c]));

export function getDeployBlock(key: ChainKey = "arc"): bigint {
  return getChain(key).deployBlock;
}

/**
 * How many `eth_getLogs` chunks to keep in flight. The deploy block is ~5M blocks
 * behind head and grows, so a serial scan is 500+ round trips — the /agents page
 * measured 74s locally and timed out on Vercel.
 *
 * Measured on Arc testnet, /agents cold render: 8 → 12.7s, 24 → 6.1s, 40 → 5.8s,
 * no 429s at any of them. 24 is where the curve flattens, so the extra sockets past
 * it only add 429 risk (see RPC_BATCH_SIZE below) for no gain.
 */
export const ARC_LOG_CONCURRENCY = (() => {
  const raw = Number(
    (typeof process !== "undefined" && process.env?.ARC_LOG_CONCURRENCY) || "24"
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 24;
})();

const PRUNED_HISTORY = /pruned history/i;

function isPrunedError(error: unknown): boolean {
  return error instanceof Error && PRUNED_HISTORY.test(error.message);
}

/**
 * The RPC serves only a trailing window of history, and the contract's deploy block
 * fell out of it long ago. Blindly scanning from deploy meant ~400 of 510 ranges
 * failed on every render — wasted round trips that pushed /stats to 31s. The
 * boundary only moves forward, so bisect for it once and reuse it per instance.
 */
// Keyed by chain id: every chain prunes on its own schedule.
const earliestReadableIndex = new Map<number, { deployBlock: bigint; index: number; at: number }>();
const EARLIEST_TTL_MS = 10 * 60 * 1000;

async function findFirstReadableRange(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  ranges: Array<{ from: bigint; to: bigint }>,
  deployBlock: bigint,
): Promise<number> {
  const chainId = client.chain?.id ?? 0;
  const cached = earliestReadableIndex.get(chainId);
  if (
    cached &&
    cached.deployBlock === deployBlock &&
    Date.now() - cached.at < EARLIEST_TTL_MS &&
    cached.index < ranges.length
  ) {
    return cached.index;
  }

  // One block is enough to tell "pruned" from "readable", and keeps the probe cheap.
  const readable = async (index: number): Promise<boolean> => {
    const { from } = ranges[index];
    try {
      await client.getLogs({ ...(params as any), fromBlock: from, toBlock: from });
      return true;
    } catch (error) {
      if (isPrunedError(error)) return false;
      throw error;
    }
  };

  let lo = 0;
  let hi = ranges.length - 1;
  if (await readable(lo)) {
    earliestReadableIndex.set(chainId, { deployBlock, index: 0, at: Date.now() });
    return 0;
  }
  // Lower bound: smallest index whose start block the RPC still serves. A boundary
  // falling mid-range costs us that range's first blocks, which is noise next to the
  // history already pruned away.
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (await readable(mid)) hi = mid;
    else lo = mid + 1;
  }

  earliestReadableIndex.set(chainId, { deployBlock, index: lo, at: Date.now() });
  return lo;
}

export async function paginatedGetLogs(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<any[]> {
  const end = toBlock ?? (await client.getBlockNumber());
  const chunkSize =
    CHAINS_BY_ID.get(client.chain?.id ?? 0)?.logChunk ?? ARC_LOG_CHUNK;

  const allRanges: Array<{ from: bigint; to: bigint }> = [];
  for (let start = fromBlock; start <= end; ) {
    const stop = start + chunkSize > end ? end : start + chunkSize;
    allRanges.push({ from: start, to: stop });
    start = stop + 1n;
  }

  const firstReadable =
    allRanges.length > 1
      ? await findFirstReadableRange(client, params, allRanges, fromBlock)
      : 0;
  const ranges = allRanges.slice(firstReadable);
  if (firstReadable > 0) {
    console.warn(
      `[arc] getLogs: skipping ${firstReadable}/${allRanges.length} pruned block ranges below ${ranges[0]?.from}.`
    );
  }

  // Results stay in range order so callers still see logs oldest-first.
  const pages: any[][] = new Array(ranges.length);
  let next = 0;
  let unavailable = 0;
  let lastError: unknown = null;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= ranges.length) return;
      const { from, to } = ranges[index];
      try {
        pages[index] = await client.getLogs({
          ...(params as any),
          fromBlock: from,
          toBlock: to,
        });
      } catch (error) {
        // The Arc RPC prunes history ("pruned history unavailable"), so ranges near
        // the deploy block are simply gone. One dead chunk used to reject the whole
        // scan and callers fell back to an empty list — the /agents page rendered
        // zero events despite the recent history being perfectly readable. Drop the
        // range we cannot read and keep the rest.
        pages[index] = [];
        unavailable++;
        lastError = error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ARC_LOG_CONCURRENCY, ranges.length) }, worker)
  );

  // Every range failing means the RPC is broken, not pruned: surface that instead
  // of pretending the contract has no history.
  if (unavailable === ranges.length && ranges.length > 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error("eth_getLogs failed for every block range");
  }
  if (unavailable > 0) {
    console.warn(
      `[arc] getLogs: ${unavailable}/${ranges.length} block ranges unavailable (pruned history); serving the readable remainder.`
    );
  }

  return pages.flat();
}

export function getExplorerTxUrl(txHash: string, key: ChainKey = "arc"): string {
  return explorerTxUrl(key, txHash);
}

export function getExplorerAddressUrl(address: string, key: ChainKey = "arc"): string {
  return explorerAddressUrl(key, address);
}

// ── viem clients ──────────────────────────────────────────────────────────────
// Arc public RPC returns HTTP 429 when slammed with 100+ parallel single-call
// readContracts (a 100-claim feed × 3 reads per claim = 300 simultaneous
// POSTs). viem's JSON-RPC batch transport bundles all eth_call requests that
// fire within `wait` ms into one POST body, which drops the request count by
// ~100x and keeps us under the throttle. retryCount/retryDelay also smooth
// over the rare 429 that still slips through.
// The cap exists because a provider can reject an oversized batch outright: a
// previous endpoint returned HTTP 413 above 10 calls and batchSize:200 silently
// stalled the whole VS index for days. The official Arc RPC accepts 40 in one
// body (measured), so 32 leaves headroom while cutting round trips by ~3x
// against the old cap. Env-tunable for endpoints with a tighter limit.
export const RPC_BATCH_SIZE = (() => {
  const raw = Number(
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_RPC_BATCH_SIZE) || "32"
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 32;
})();

const ARC_HTTP_OPTS = {
  batch: { batchSize: RPC_BATCH_SIZE, wait: 16 },
  // Keep per-request budgets tight: callers (readClaimRaw, agent poll loops)
  // have their own outer retries, and a hanging RPC must fail fast enough for
  // serverless routes to fall back to cached data instead of 504ing.
  retryCount: 2,
  retryDelay: 300,
  timeout: 10_000,
};

const publicClients = new Map<ChainKey, PublicClient>();

/** Batched, retrying read client for `key`, one per process per chain. */
export function createChainPublicClient(key: ChainKey = "arc"): PublicClient {
  let c = publicClients.get(key);
  if (!c) {
    c = createPublicClient({
      chain: getChain(key).chain,
      transport: http(getRpcUrl(key), ARC_HTTP_OPTS),
    }) as PublicClient;
    publicClients.set(key, c);
  }
  return c;
}

export function createArcPublicClient(): PublicClient {
  return createChainPublicClient("arc");
}

export function createChainHttpTransport(key: ChainKey = "arc") {
  return http(getRpcUrl(key), ARC_HTTP_OPTS);
}

export function createArcHttpTransport() {
  return createChainHttpTransport("arc");
}

export function createArcWalletClient(provider: unknown): WalletClient {
  return createWalletClient({
    chain: arcTestnet,
    transport: custom(provider as any),
  });
}

export function createArcWalletClientWithKey(privateKey: string, key: ChainKey = "arc"): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    chain: getChain(key).chain,
    account,
    transport: http(getRpcUrl(key), ARC_HTTP_OPTS),
  });
}

// ── Unit helpers (Arc only — use usdcToStakeUnits/stakeUnitsToUsdc in lib/chains for others) ──────────────────────────────────────────────────────────
// Arc USDC: 18 decimals at EVM level (like ETH on Ethereum)
// Display: 6 significant decimal places (standard USDC display)
// 1 USDC = 1_000_000_000_000_000_000 wei
export const USDC_DECIMALS = 18;
export const USDC_UNIT = BigInt(10 ** USDC_DECIMALS); // 1_000_000_000_000_000_000n

export function usdcToWei(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("Invalid USDC amount");
  // Support up to 6 significant decimal places (standard USDC precision)
  return BigInt(Math.round(usdc * 1_000_000)) * BigInt(10 ** 12);
}

export function weiToUsdc(micro: bigint | number): number {
  return Number(BigInt(micro) / BigInt(10 ** 12)) / 1_000_000;
}

export function formatUsdc(micro: bigint | number, decimals = 2): string {
  return weiToUsdc(micro).toFixed(decimals) + " USDC";
}
