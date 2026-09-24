/**
 * Mimir contract client (viem), multichain.
 *
 * Every read and write names a ChainKey. On Arc USDC is native (msg.value,
 * 18 decimals); on Base and Arbitrum it is a 6-decimal ERC-20 the escrow pulls
 * after an approve. Callers pass whole USDC and never see either unit.
 */
import {
  createPublicClient,
  http,
  parseEventLogs,
  type Log,
  type PublicClient,
} from "viem";

import { erc20Abi } from "viem";
import { getContractAddress, RPC_BATCH_SIZE } from "./arc";
import {
  getChain,
  enabledChainKeys,
  requireContractAddress,
  supportsRematch,
  usdcToStakeUnits,
  stakeUnitsToUsdc,
  explorerTxUrl,
  type ChainKey,
} from "./chains";
import { MIMIR_ABI, STATE, WINNER_SIDE, BPS_DIVISOR } from "./mimir-abi";
import { MIMIR_V3_ABI } from "./mimir-v3-abi";
import { normalizeCategoryId, ZERO_ADDRESS } from "./constants";
import { decodeClaimTuple } from "./claim-codec";
import type { VSCacheFreshness } from "./vs-freshness";

// ── Constants ─────────────────────────────────────────────────────────────────
/** @deprecated Arc only — use getContractAddress(chain). */
export const CONTRACT_ADDRESS = getContractAddress("arc");

export type { ChainKey };

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface ClaimChallenger {
  address: string;
  stake: number;
  potential_payout: number;
}

export interface ClaimData {
  id: number;
  /** Network the claim lives on. Ids are only unique within a chain. */
  chain: ChainKey;
  creator: string;
  question: string;
  creator_position: string;
  counter_position: string;
  resolution_url: string;
  creator_stake: number;
  total_challenger_stake: number;
  reserved_creator_liability: number;
  available_creator_liability: number;
  deadline: number;
  state: "open" | "active" | "resolved" | "cancelled";
  winner_side: "creator" | "challengers" | "draw" | "unresolvable" | "";
  resolution_summary: string;
  confidence: number;
  category: string;
  parent_id: number;
  challenger_count: number;
  market_type: string;
  odds_mode: string;
  challenger_payout_bps: number;
  handicap_line: string;
  settlement_rule: string;
  max_challengers: number;
  created_at?: number;
  visibility?: "public" | "private";
  is_private?: boolean;
  challengers?: ClaimChallenger[];
  first_challenger?: string;
  challenger_addresses?: string[];
  total_pot: number;
  evidence_hash?: string;          // keccak256 of oracle evidence — on-chain reasoning trace
  /** @deprecated not used on Arc — oracle resolves automatically */
  resolve_attempts?: number;
  /** @deprecated not used on Arc */
  creator_requested_resolve?: boolean;
  /** @deprecated not used on Arc */
  challenger_requested_resolve?: boolean;
}

export interface VSData {
  id: number;
  /** Absent on rows written before multichain: those are Arc. */
  chain?: ChainKey;
  creator: string;
  opponent: string;
  question: string;
  creator_position: string;
  opponent_position: string;
  resolution_url: string;
  stake_amount: number;
  deadline: number;
  state: "open" | "accepted" | "resolved" | "cancelled";
  winner: string;
  resolution_summary: string;
  created_at?: number;
  category: string;
  challengers?: ClaimChallenger[];
  counter_position?: string;
  creator_stake?: number;
  total_challenger_stake?: number;
  reserved_creator_liability?: number;
  available_creator_liability?: number;
  winner_side?: ClaimData["winner_side"];
  confidence?: number;
  parent_id?: number;
  challenger_count?: number;
  market_type?: string;
  odds_mode?: string;
  challenger_payout_bps?: number;
  handicap_line?: string;
  settlement_rule?: string;
  max_challengers?: number;
  visibility?: ClaimData["visibility"];
  is_private?: boolean;
  total_pot?: number;
  challenger_addresses?: string[];
  // Resolution-request flow (optional, surfaces off-chain UI state)
  creator_requested_resolve?: boolean;
  challenger_requested_resolve?: boolean;
  resolve_attempts?: number;
}

export interface CreateClaimParams {
  question: string;
  creator_position: string;
  counter_position: string;
  resolution_url: string;
  deadline: number;
  stake_amount: number;         // in whole USDC (e.g. 5 = 5 USDC)
  category?: string;
  parent_id?: number;
  market_type?: string;
  odds_mode?: string;
  challenger_payout_bps?: number;
  handicap_line?: string;
  settlement_rule?: string;
  max_challengers?: number;
  visibility?: "public" | "private";
  invite_key?: string;
  /** Network to open the claim on. Defaults to Arc. */
  chain?: ChainKey;
}

export interface ContractWriteResult {
  txHash: string;
  explorerUrl?: string;
  /** @deprecated use explorerUrl */
  explorerTxHash?: string;
  receipt: unknown;
  pending?: boolean;
}

export interface ClaimWriteResult extends ContractWriteResult {
  claimId: number | null;
}

export interface VSFeedSnapshot {
  items: VSData[];
  cache: VSCacheFreshness | null;
}

export interface VSDetailSnapshot {
  item: VSData | null;
  cache: VSCacheFreshness | null;
}

// ── State / side mappers ──────────────────────────────────────────────────────
function mapState(n: number): ClaimData["state"] {
  switch (n) {
    case STATE.OPEN:      return "open";
    case STATE.ACTIVE:    return "active";
    case STATE.RESOLVED:  return "resolved";
    case STATE.CANCELLED: return "cancelled";
    // Proposed or disputed verdicts are not final: the claim is still live
    // money. The dispute panel reads the proposal itself.
    case STATE.PROPOSED:
    case STATE.DISPUTED:  return "active";
    default: return "open";
  }
}

function mapWinnerSide(n: number): ClaimData["winner_side"] {
  switch (n) {
    case WINNER_SIDE.CREATOR:      return "creator";
    case WINNER_SIDE.CHALLENGERS:  return "challengers";
    case WINNER_SIDE.DRAW:         return "draw";
    case WINNER_SIDE.UNRESOLVABLE: return "unresolvable";
    default: return "";
  }
}

// ── viem public client (one per chain per process) ────────────────────────────
// Same JSON-RPC batching as lib/arc.ts ARC_HTTP_OPTS, with a longer timeout
// because the feed fans out hundreds of reads.
const _publicClients = new Map<ChainKey, PublicClient>();
function getPublicClient(chain: ChainKey = "arc"): PublicClient {
  let c = _publicClients.get(chain);
  if (!c) {
    const cfg = getChain(chain);
    c = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl, {
        batch: { batchSize: RPC_BATCH_SIZE, wait: 16 },
        retryCount: 3,
        retryDelay: 300,
        timeout: 20_000,
      }),
    }) as PublicClient;
    _publicClients.set(chain, c);
  }
  return c;
}

export function vsChain(vs: { chain?: ChainKey }): ChainKey {
  return vs.chain ?? "arc";
}

// ── Bulk-read concurrency limiter ─────────────────────────────────────────────
// Arc testnet RPC returns 429 when hit with hundreds of parallel readContract
// calls. Every claim costs 3 RPC calls (getClaim + getClaimMarketConfig +
// getChallengerList), so `Promise.all` over 100+ claims = ~300 parallel
// requests = throttled.
//
// We funnel all bulk claim reads through this helper instead. Default of 5
// keeps peak concurrency at ~15 (5 claims × 3 calls), well within any sane
// RPC rate limit. Tuneable via NEXT_PUBLIC_RPC_READ_CONCURRENCY if Arc gets
// generous.
const READ_CONCURRENCY = (() => {
  const raw = Number(
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_RPC_READ_CONCURRENCY) || "5"
  );
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
})();

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = READ_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function readClaimsRange(
  startId: number,
  count: number,
  chain: ChainKey = "arc",
): Promise<(ClaimData | null)[]> {
  const ids = Array.from({ length: count }, (_, i) => startId + i);
  return mapWithConcurrency(ids, (id) => readClaimRaw(id, chain));
}

/** Every claim on every deployed chain. One dead chain does not blank the rest. */
async function readAllChains(): Promise<ClaimData[]> {
  const perChain = await Promise.all(
    enabledChainKeys().map(async (chain) => {
      try {
        const count = await getClaimCount(chain);
        if (count <= 0) return [];
        return (await readClaimsRange(1, count, chain)).filter(Boolean) as ClaimData[];
      } catch (err) {
        console.warn(`[contract] ${chain} read failed`, err);
        return [];
      }
    }),
  );
  return perChain.flat();
}

/** Newest first across chains. Ids collide between chains, creation time does not. */
function byNewest(a: VSData, b: VSData): number {
  return (b.created_at ?? 0) - (a.created_at ?? 0) || b.id - a.id;
}

// ── Raw on-chain read ─────────────────────────────────────────────────────────
const READ_CLAIM_RETRY_ATTEMPTS = 3;
const READ_CLAIM_RETRY_BASE_MS = 200;

async function readClaimContractTriplet(client: PublicClient, claimId: number, chain: ChainKey) {
  const CONTRACT_ADDRESS = getContractAddress(chain);
  return Promise.all([
    client.readContract({
      address:      CONTRACT_ADDRESS,
      abi:          MIMIR_ABI,
      functionName: "getClaim",
      args:         [BigInt(claimId)],
    }) as Promise<readonly any[]>,
    client.readContract({
      address:      CONTRACT_ADDRESS,
      abi:          MIMIR_ABI,
      functionName: "getClaimMarketConfig",
      args:         [BigInt(claimId)],
    }) as Promise<readonly any[]>,
    client.readContract({
      address:      CONTRACT_ADDRESS,
      abi:          MIMIR_ABI,
      functionName: "getChallengerList",
      args:         [BigInt(claimId)],
    }) as Promise<[string[], bigint[]]>,
  ]);
}

export async function readClaimRaw(
  claimId: number,
  chain: ChainKey = "arc",
): Promise<ClaimData | null> {
  const client = getPublicClient(chain);
  let base: readonly any[] | null = null;
  let market: readonly any[] | null = null;
  let challengerData: [string[], bigint[]] | null = null;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < READ_CLAIM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      [base, market, challengerData] = await readClaimContractTriplet(client, claimId, chain);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < READ_CLAIM_RETRY_ATTEMPTS - 1) {
        const backoff = READ_CLAIM_RETRY_BASE_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  if (lastError || !base || !market || !challengerData) {
    if (lastError) {
      console.warn(`[readClaimRaw] ${chain} claim ${claimId} failed after ${READ_CLAIM_RETRY_ATTEMPTS} attempts`, lastError);
    }
    return null;
  }

  try {
    const decoded = decodeClaimTuple(claimId, base, market);
    if (!decoded) return null;

    const toUsdc = (v: bigint) => stakeUnitsToUsdc(chain, v);
    const creatorStakeUsdc = toUsdc(decoded.creatorStake);
    const totalChStakeUsdc = toUsdc(decoded.totalChallengerStake);
    const reservedUsdc     = toUsdc(decoded.reservedCreatorLiability);

    const [chAddrs, chStakes] = challengerData;
    const payBps  = Number(decoded.challengerPayoutBps);
    const isFixed = decoded.oddsMode === "fixed";
    const challengers: ClaimChallenger[] = chAddrs.map((addr, i) => {
      const stake  = toUsdc(chStakes[i]);
      const payout = isFixed
        ? (stake * payBps) / BPS_DIVISOR
        : stake + (totalChStakeUsdc > 0 ? (stake / totalChStakeUsdc) * creatorStakeUsdc : 0);
      return { address: addr, stake, potential_payout: payout };
    });

    const availLiab = Math.max(0, creatorStakeUsdc - reservedUsdc);

    return {
      id:                         claimId,
      chain,
      creator:                    decoded.creator,
      question:                   decoded.question,
      creator_position:           decoded.creatorPosition,
      counter_position:           decoded.counterPosition,
      resolution_url:             decoded.resolutionUrl,
      creator_stake:              creatorStakeUsdc,
      total_challenger_stake:     totalChStakeUsdc,
      reserved_creator_liability: reservedUsdc,
      available_creator_liability: availLiab,
      deadline:                   Number(decoded.deadline),
      state:                      mapState(decoded.state),
      winner_side:                mapWinnerSide(decoded.winnerSide),
      resolution_summary:         decoded.resolutionSummary,
      confidence:                 decoded.confidence,
      category:                   normalizeCategoryId(decoded.category),
      parent_id:                  Number(decoded.parentId),
      challenger_count:           Number(decoded.challengerCount),
      created_at:                 Number(decoded.createdAt),
      evidence_hash:              decoded.evidenceHash,
      market_type:                decoded.marketType,
      odds_mode:                  decoded.oddsMode,
      challenger_payout_bps:      payBps,
      handicap_line:              decoded.handicapLine,
      settlement_rule:            decoded.settlementRule,
      max_challengers:            Number(decoded.maxChallengers),
      visibility:                 decoded.isPrivate ? "private" : "public",
      is_private:                 decoded.isPrivate,
      challengers,
      first_challenger:           chAddrs[0] ?? ZERO_ADDRESS,
      challenger_addresses:       chAddrs,
      total_pot:                  creatorStakeUsdc + totalChStakeUsdc,
    };
  } catch (err) {
    console.warn(`[readClaimRaw] decode failed for claim ${claimId}`, err);
    return null;
  }
}

// ── Public read functions ─────────────────────────────────────────────────────
export async function getClaim(claimId: number, chain: ChainKey = "arc"): Promise<ClaimData | null> {
  return readClaimRaw(claimId, chain);
}

export async function getClaimCount(chain: ChainKey = "arc"): Promise<number> {
  const count = await getPublicClient(chain).readContract({
    address:      getContractAddress(chain),
    abi:          MIMIR_ABI,
    functionName: "claimCount",
  }) as bigint;
  return Number(count);
}

export async function getVSSummaries(
  startId: number,
  limit: number,
  chain: ChainKey = "arc",
): Promise<VSData[]> {
  const results = await readClaimsRange(startId, limit, chain);
  return (results.filter(Boolean) as ClaimData[]).map(mapClaimToVS);
}

function involves(c: ClaimData, address: string): boolean {
  const addr = address.toLowerCase();
  return (
    c.creator.toLowerCase() === addr ||
    (c.challenger_addresses ?? []).some((a) => a.toLowerCase() === addr)
  );
}

export async function getUserVSSummaries(address: string): Promise<VSData[]> {
  return (await readAllChains()).filter((c) => involves(c, address)).map(mapClaimToVS);
}

/** Wins and losses, summed across chains unless one is named. */
export async function getUserStats(
  address: string,
  chain?: ChainKey,
): Promise<{ wins: number; losses: number }> {
  const chains = chain ? [chain] : enabledChainKeys();
  const rows = await Promise.all(
    chains.map(async (c) => {
      const [wins, losses] = (await getPublicClient(c).readContract({
        address:      getContractAddress(c),
        abi:          MIMIR_ABI,
        functionName: "getUserStats",
        args:         [address as `0x${string}`],
      })) as [bigint, bigint];
      return { wins: Number(wins), losses: Number(losses) };
    }),
  );
  return rows.reduce((t, r) => ({ wins: t.wins + r.wins, losses: t.losses + r.losses }), {
    wins: 0,
    losses: 0,
  });
}

/** Platform totals, summed across chains unless one is named. */
export async function getPlatformStats(chain?: ChainKey): Promise<{
  total_claims: number;
  total_resolved: number;
  total_pool: number;
}> {
  const chains = chain ? [chain] : enabledChainKeys();
  const rows = await Promise.all(
    chains.map(async (c) => {
      const [totalClaims, resolved, balance] = (await getPublicClient(c).readContract({
        address:      getContractAddress(c),
        abi:          MIMIR_ABI,
        functionName: "getPlatformStats",
      })) as [bigint, bigint, bigint];
      return {
        total_claims:   Number(totalClaims),
        total_resolved: Number(resolved),
        total_pool:     stakeUnitsToUsdc(c, balance),
      };
    }),
  );
  return rows.reduce(
    (t, r) => ({
      total_claims:   t.total_claims + r.total_claims,
      total_resolved: t.total_resolved + r.total_resolved,
      total_pool:     t.total_pool + r.total_pool,
    }),
    { total_claims: 0, total_resolved: 0, total_pool: 0 },
  );
}

// ── Fast feed (browser uses /api/vs, server reads directly) ──────────────────
export async function getAllVSFast(): Promise<VSFeedSnapshot> {
  if (typeof window !== "undefined") {
    const res = await fetch("/api/vs");
    if (!res.ok) throw new Error(`/api/vs returned ${res.status}`);
    const data = await res.json();
    return { items: data.items ?? [], cache: data.cache ?? null };
  }
  return getAllVSDirect();
}

export async function getAllVSDirect(): Promise<VSFeedSnapshot> {
  // One concurrency-limited read per chain — paginating then Promise.all-ing
  // pages just multiplied the request burst and was the main 429 source.
  const all = await readAllChains();
  return {
    items: all.map(mapClaimToVS).sort(byNewest),
    cache: makeLiveFreshness(),
  };
}

export async function getUserVSFast(address: string): Promise<VSFeedSnapshot> {
  if (typeof window !== "undefined") {
    const res = await fetch(`/api/vs/user/${address}`);
    if (!res.ok) throw new Error(`/api/vs/user returned ${res.status}`);
    const data = await res.json();
    return { items: data.items ?? [], cache: data.cache ?? null };
  }
  const items = await getUserVSSummaries(address);
  return { items: items.sort(byNewest), cache: makeLiveFreshness() };
}

function vsApiUrl(vsId: number, opts?: { inviteKey?: string; chain?: ChainKey }): string {
  const q = new URLSearchParams();
  if (opts?.chain && opts.chain !== "arc") q.set("chain", opts.chain);
  if (opts?.inviteKey) q.set("invite", opts.inviteKey);
  const qs = q.toString();
  return `/api/vs/${vsId}${qs ? `?${qs}` : ""}`;
}

/**
 * Returns VSData, or null when the claim does not exist. A transient failure
 * (429, 5xx) throws instead: treating it as "not found" used to wipe a live
 * claim off the page mid-challenge.
 */
export async function getVS(
  vsId: number,
  opts?: { inviteKey?: string; viewerAddress?: string; chain?: ChainKey }
): Promise<VSData | null> {
  if (typeof window !== "undefined") {
    const res = await fetch(vsApiUrl(vsId, opts));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load this claim right now (HTTP ${res.status}). Please try again.`);
    const data = await res.json();
    return data.item ?? null;
  }
  const claim = await readClaimRaw(vsId, opts?.chain ?? "arc");
  return claim ? mapClaimToVS(claim) : null;
}

/** Returns VSDetailSnapshot with cache metadata. */
export async function getVSFull(
  vsId: number,
  opts?: { inviteKey?: string; viewerAddress?: string; chain?: ChainKey }
): Promise<VSDetailSnapshot> {
  if (typeof window !== "undefined") {
    const res = await fetch(vsApiUrl(vsId, opts));
    if (!res.ok) return { item: null, cache: null };
    const data = await res.json();
    return { item: data.item ?? null, cache: data.cache ?? null };
  }
  const claim = await readClaimRaw(vsId, opts?.chain ?? "arc");
  return { item: claim ? mapClaimToVS(claim) : null, cache: makeLiveFreshness() };
}

// ── Write plumbing shared by browser and server ──────────────────────────────
/**
 * The ABI a chain's escrow speaks, and the args adjusted to it. v3 adds an
 * agent-owner attribution arg to createClaim and challengeClaim; a human
 * position through the web app has no agent, so it is always zero here.
 */
function writeCall(chain: ChainKey, functionName: string, args: unknown[]) {
  if (getChain(chain).abiVersion === "v2") {
    return { abi: MIMIR_ABI as readonly unknown[], args };
  }
  const attributed =
    functionName === "createClaim" || functionName === "challengeClaim"
      ? [...args, ZERO_ADDRESS]
      : args;
  return { abi: MIMIR_V3_ABI as readonly unknown[], args: attributed };
}

/** msg.value for a stake: the stake itself on Arc, zero on ERC-20 chains. */
function nativeValue(chain: ChainKey, valueUsdc: number): bigint {
  return getChain(chain).stakeMode === "native" ? usdcToStakeUnits(chain, valueUsdc) : 0n;
}

/**
 * ERC-20 chains: make sure the escrow may pull `valueUsdc` from `account`.
 * Approves the exact amount rather than unlimited, so a compromised escrow can
 * never reach more than the stake being placed.
 */
async function ensureAllowance(
  chain: ChainKey,
  account: `0x${string}`,
  valueUsdc: number,
  approve: (amount: bigint) => Promise<`0x${string}`>,
): Promise<void> {
  const cfg = getChain(chain);
  if (cfg.stakeMode !== "erc20" || valueUsdc <= 0) return;
  const need = usdcToStakeUnits(chain, valueUsdc);
  const spender = requireContractAddress(chain);
  const client = getPublicClient(chain);
  const [allowance, balance] = await Promise.all([
    client.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "allowance", args: [account, spender] }),
    client.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
  ]);
  if (balance < need) {
    throw new Error(`Not enough USDC on ${cfg.name}: need ${valueUsdc}, have ${stakeUnitsToUsdc(chain, balance)}`);
  }
  if (allowance >= need) return;
  const hash = await approve(need);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") throw new Error("USDC approval reverted");
}

/**
 * The id a createClaim/createRematch receipt minted, read from its
 * ClaimCreated event. Reading claimCount() afterwards races every other
 * creator (the market-creator agent opens claims constantly) and returns
 * someone else's id.
 */
export function claimIdFromReceipt(receipt: unknown, escrowAddress: string): number | null {
  const logs = (receipt as { logs?: unknown } | null | undefined)?.logs;
  if (!Array.isArray(logs)) return null;
  const escrow = escrowAddress.toLowerCase();
  const events = parseEventLogs({
    abi: MIMIR_ABI,
    eventName: "ClaimCreated",
    logs: logs as Log[],
  }).filter((e) => e.address.toLowerCase() === escrow);
  const id = events[0]?.args.id;
  return id === undefined ? null : Number(id);
}

// ── Write: browser (the wallet connected through wagmi) ──────────────────────
async function sendBrowserTx(
  chain: ChainKey,
  functionName: string,
  args: unknown[],
  valueUsdc: number
): Promise<ContractWriteResult> {
  if (typeof window === "undefined") throw new Error("Browser writes need a browser.");
  const cfg = getChain(chain);

  // The wallet the user actually connected (injected, WalletConnect, Coinbase),
  // not whatever happens to sit on window.ethereum. Loaded lazily: this module
  // is also imported server-side, where the connectors must not load.
  const [{ getAccount, getWalletClient, switchChain }, { wagmiConfig }] = await Promise.all([
    import("wagmi/actions"),
    import("./wagmi-config"),
  ]);
  if (!getAccount(wagmiConfig).address) {
    throw new Error("No wallet connected. Please connect a wallet first.");
  }
  if (getAccount(wagmiConfig).chainId !== cfg.chain.id) {
    await switchChain(wagmiConfig, { chainId: cfg.chain.id });
  }
  const wc = await getWalletClient(wagmiConfig, { chainId: cfg.chain.id });
  const account = wc.account.address;

  // Native stakes (Arc) have no allowance step to catch a short balance, and a
  // wallet's own error for it is an unreadable gas estimation failure.
  if (cfg.stakeMode === "native" && valueUsdc > 0) {
    const balance = await getPublicClient(chain).getBalance({ address: account });
    if (balance < nativeValue(chain, valueUsdc)) {
      throw new Error(`Not enough USDC on ${cfg.name}: need ${valueUsdc}, have ${stakeUnitsToUsdc(chain, balance)}`);
    }
  }

  await ensureAllowance(chain, account, valueUsdc, (amount) =>
    wc.writeContract({
      address: cfg.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [requireContractAddress(chain), amount],
      account,
      chain: cfg.chain,
    }),
  );

  const call = writeCall(chain, functionName, args);
  const txHash = await wc.writeContract({
    address:      requireContractAddress(chain),
    abi:          call.abi as any,
    functionName: functionName as any,
    args:         call.args as any,
    // value cast: with functionName widened to `any`, viem unions all ABI
    // entries and collapses `value` to `undefined` (nonpayable fns like
    // withdraw exist alongside payable createClaim/challengeClaim).
    value:        nativeValue(chain, valueUsdc) as any,
    account,
    chain:        cfg.chain,
  });

  const explorerUrl = explorerTxUrl(chain, txHash);
  try {
    const receipt = await Promise.race([
      getPublicClient(chain).waitForTransactionReceipt({ hash: txHash }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 30_000)),
    ]);
    if ((receipt as any).status === "reverted") throw new Error("Transaction reverted");
    return { txHash, explorerUrl, explorerTxHash: explorerUrl, receipt, pending: false };
  } catch (err: any) {
    if (err?.message === "Transaction reverted") throw err;
    return { txHash, explorerUrl, explorerTxHash: explorerUrl, receipt: null, pending: true };
  }
}

/**
 * Ask the read index to re-read one claim right after a confirmed write, so
 * the page's next fetch shows the new state instead of waiting for the cron.
 * Best-effort: the index catches up on its own if this fails.
 */
async function refreshIndexAfterWrite(chain: ChainKey, claimId: number | null, inviteKey?: string): Promise<void> {
  if (claimId === null || typeof window === "undefined") return;
  try {
    await fetch("/api/vs/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimId, chain, inviteKey: inviteKey || null }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    /* the cron reconcile covers it */
  }
}

// ── Public write functions ────────────────────────────────────────────────────
export async function createClaim(
  wallet: string,
  params: CreateClaimParams
): Promise<ClaimWriteResult> {
  const chain = params.chain ?? "arc";
  const args = buildCreateArgs(params);

  const result = await sendBrowserTx(chain, "createClaim", args, params.stake_amount);
  const claimId = claimIdFromReceipt(result.receipt, requireContractAddress(chain));
  await refreshIndexAfterWrite(chain, claimId, params.invite_key);
  return { ...result, claimId };
}

export async function challengeClaim(
  wallet: string,
  claimId: number,
  stakeAmount: number,
  inviteKey = "",
  chain: ChainKey = "arc",
): Promise<ClaimWriteResult> {
  const result = await sendBrowserTx(
    chain,
    "challengeClaim",
    [BigInt(claimId), usdcToStakeUnits(chain, stakeAmount), inviteKey],
    stakeAmount
  );
  if (!result.pending) await refreshIndexAfterWrite(chain, claimId, inviteKey);
  return { ...result, claimId };
}

export async function resolveClaim(
  wallet: string,
  claimId: number,
  chain: ChainKey = "arc",
): Promise<ClaimWriteResult> {
  // Browser resolution is not supported — resolution is oracle-only.
  throw new Error(
    "Claims are resolved by the Mimir oracle agent. Connect as oracle to resolve manually."
  );
}

export async function cancelClaim(
  wallet: string,
  claimId: number,
  chain: ChainKey = "arc",
): Promise<ClaimWriteResult> {
  const result = await sendBrowserTx(chain, "cancelClaim", [BigInt(claimId)], 0);
  if (!result.pending) await refreshIndexAfterWrite(chain, claimId);
  return { ...result, claimId };
}

/**
 * Payouts that could not be pushed at settlement (a reverting receiver, a
 * blocklisted address) wait in the escrow's pendingWithdrawals. Per chain,
 * in whole USDC; chains whose read fails are left out.
 */
export async function getPendingWithdrawals(
  address: `0x${string}`,
  chains: ChainKey[] = enabledChainKeys(),
): Promise<Array<{ chain: ChainKey; usdc: number }>> {
  const reads = await Promise.all(
    chains.map(async (chain) => {
      try {
        const units = (await getPublicClient(chain).readContract({
          address: requireContractAddress(chain),
          abi: MIMIR_ABI,
          functionName: "pendingWithdrawals",
          args: [address],
        })) as bigint;
        return { chain, usdc: stakeUnitsToUsdc(chain, units) };
      } catch {
        return null;
      }
    }),
  );
  return reads.filter((r): r is { chain: ChainKey; usdc: number } => r !== null && r.usdc > 0);
}

export interface DisputeStatus {
  state: number;
  deadline: number;
  proposal: { winnerSide: number; confidence: number; proposedAt: number; disputer: string; summary: string } | null;
  disputeWindow: number;
  bondUsdc: number;
  isParticipant: boolean;
  /** Escrow build supports the dispute/refund functions (newer MimirV3 deploys). */
  supported: boolean;
}

/** Proposal and dispute state for a claim on a MimirV3 escrow; null on v2 chains. */
export async function getDisputeStatus(chain: ChainKey, claimId: number, viewer?: string | null): Promise<DisputeStatus | null> {
  if (getChain(chain).abiVersion !== "v3") return null;
  const client = getPublicClient(chain);
  const address = requireContractAddress(chain);
  const base = (await client.readContract({ address, abi: MIMIR_V3_ABI, functionName: "getClaim", args: [BigInt(claimId)] })) as readonly unknown[];
  const creator = String(base[0]);
  const state = Number(base[9]);
  const deadline = Number(base[8] as bigint);
  const [windowRes, proposalRes, minStake, challenged] = await Promise.all([
    client.readContract({ address, abi: MIMIR_V3_ABI, functionName: "disputeWindow" }).catch(() => null),
    client.readContract({ address, abi: MIMIR_V3_ABI, functionName: "proposals", args: [BigInt(claimId)] }).catch(() => null),
    client.readContract({ address, abi: MIMIR_V3_ABI, functionName: "MIN_STAKE" }).catch(() => 0n),
    viewer
      ? client.readContract({ address, abi: MIMIR_V3_ABI, functionName: "hasChallenged", args: [BigInt(claimId), viewer as `0x${string}`] }).catch(() => false)
      : Promise.resolve(false),
  ]);
  const p = proposalRes as readonly unknown[] | null;
  return {
    state,
    deadline,
    proposal: p && Number(p[2]) > 0
      ? { winnerSide: Number(p[0]), confidence: Number(p[1]), proposedAt: Number(p[2]), disputer: String(p[4]), summary: String(p[7] ?? "") }
      : null,
    disputeWindow: windowRes === null ? 0 : Number(windowRes as bigint),
    bondUsdc: stakeUnitsToUsdc(chain, minStake as bigint),
    isParticipant: Boolean(viewer) && (viewer!.toLowerCase() === creator.toLowerCase() || Boolean(challenged)),
    supported: windowRes !== null,
  };
}

/** Dispute a proposed verdict, posting the MIN_STAKE bond. */
export async function disputeResolution(chain: ChainKey, claimId: number, bondUsdc: number): Promise<ContractWriteResult> {
  const result = await sendBrowserTx(chain, "disputeResolution", [BigInt(claimId)], bondUsdc);
  if (!result.pending) await refreshIndexAfterWrite(chain, claimId);
  return result;
}

/** Settle an undisputed proposal after its window (anyone may). */
export async function finalizeResolution(chain: ChainKey, claimId: number): Promise<ContractWriteResult> {
  const result = await sendBrowserTx(chain, "finalizeResolution", [BigInt(claimId)], 0);
  if (!result.pending) await refreshIndexAfterWrite(chain, claimId);
  return result;
}

/** Refund an ACTIVE (or unruled disputed) claim the oracle never settled. */
export async function refundExpired(chain: ChainKey, claimId: number): Promise<ContractWriteResult> {
  const result = await sendBrowserTx(chain, "refundExpired", [BigInt(claimId)], 0);
  if (!result.pending) await refreshIndexAfterWrite(chain, claimId);
  return result;
}

/** Pull this wallet's parked payout on one chain. */
export async function withdrawPending(chain: ChainKey): Promise<ContractWriteResult> {
  return sendBrowserTx(chain, "withdraw", [], 0);
}

export async function createRematch(
  wallet: string,
  parentId: number,
  params: Pick<CreateClaimParams, "deadline" | "stake_amount" | "invite_key" | "chain">
): Promise<ClaimWriteResult> {
  // A rematch lives on its parent's chain: parentId means nothing elsewhere.
  const chain = params.chain ?? "arc";
  assertRematchSupported(chain);
  const result = await sendBrowserTx(
    chain,
    "createRematch",
    [BigInt(parentId), BigInt(params.deadline), usdcToStakeUnits(chain, params.stake_amount), params.invite_key ?? ""],
    params.stake_amount
  );
  const claimId = claimIdFromReceipt(result.receipt, requireContractAddress(chain));
  await refreshIndexAfterWrite(chain, claimId, params.invite_key);
  return { ...result, claimId };
}

function assertRematchSupported(chain: ChainKey): void {
  if (!supportsRematch(chain)) {
    throw new Error(
      `Rematches are unavailable on ${getChain(chain).name} until its escrow moves to MimirV3.`
    );
  }
}

// ── Helper: build createClaim args tuple ──────────────────────────────────────
function buildCreateArgs(p: CreateClaimParams): unknown[] {
  return [
    p.question,
    p.creator_position,
    p.counter_position,
    p.resolution_url,
    BigInt(p.deadline),
    usdcToStakeUnits(p.chain ?? "arc", p.stake_amount),
    p.category ?? "custom",
    BigInt(p.parent_id ?? 0),
    p.market_type ?? "binary",
    p.odds_mode ?? "pool",
    BigInt(p.challenger_payout_bps ?? 0),
    p.handicap_line ?? "",
    p.settlement_rule ?? "",
    BigInt(p.max_challengers ?? 0),
    p.visibility === "private",
    p.invite_key ?? "",
  ];
}

// ── Demo mode helpers ─────────────────────────────────────────────────────────
// ── Freshness helper ──────────────────────────────────────────────────────────
function makeLiveFreshness(): VSCacheFreshness {
  return {
    source:           "contract",
    status:           "live",
    lastUpdatedAt:    new Date().toISOString(),
    ageMs:            0,
    freshnessWindowMs: 1,
  };
}

// ── VS data helpers ───────────────────────────────────────────────────────────
function isSameAddress(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function mapClaimToVS(claim: ClaimData): VSData {
  const firstChallenger = claim.first_challenger ?? ZERO_ADDRESS;
  const state = claim.state === "active" ? "accepted" : (claim.state as VSData["state"]);

  let winner = ZERO_ADDRESS;
  if (claim.winner_side === "creator") winner = claim.creator;
  else if (claim.winner_side === "challengers") {
    winner = claim.challenger_addresses?.[0] ?? firstChallenger;
  }

  return {
    ...claim,
    opponent:          firstChallenger,
    opponent_position: claim.counter_position,
    stake_amount:      claim.creator_stake,
    state,
    winner,
  };
}

export function isVSPrivate(vs: Pick<VSData, "is_private" | "visibility">) {
  return Boolean(vs.is_private || vs.visibility === "private");
}

export function getVSConfiguredMaxChallengers(vs: VSData) {
  return typeof vs.max_challengers === "number" && vs.max_challengers > 0
    ? vs.max_challengers
    : 1;
}

export function getVSChallengerCount(vs: VSData) {
  if (typeof vs.challenger_count === "number" && vs.challenger_count >= 0) {
    return vs.challenger_count;
  }
  return vs.opponent !== ZERO_ADDRESS ? 1 : 0;
}

export function hasZeroAddressWinner(vs: VSData) {
  return !vs.winner || vs.winner === ZERO_ADDRESS;
}

export function isVSMultiChallengerWin(vs: VSData) {
  return vs.winner_side === "challengers" && getVSChallengerCount(vs) !== 1;
}

export function getVSTotalPot(vs: VSData) {
  if (typeof vs.total_pot === "number" && Number.isFinite(vs.total_pot)) return vs.total_pot;
  if (typeof vs.creator_stake === "number" && typeof vs.total_challenger_stake === "number") {
    return vs.creator_stake + vs.total_challenger_stake;
  }
  return vs.stake_amount * (vs.opponent === ZERO_ADDRESS ? 1 : 2);
}

export function getVSSingleWinnerPayout(vs: VSData): number | null {
  if (!hasVSWinner(vs)) return 0;

  if (vs.winner_side === "creator" || isSameAddress(vs.winner, vs.creator)) {
    return getVSTotalPot(vs);
  }

  if (vs.winner_side === "challengers") {
    if (getVSChallengerCount(vs) !== 1) return null;
    const stake = vs.total_challenger_stake ?? vs.stake_amount;
    if (vs.odds_mode === "fixed" && (vs.challenger_payout_bps ?? 0) > 0) {
      return Math.floor((stake * vs.challenger_payout_bps!) / BPS_DIVISOR);
    }
    return getVSTotalPot(vs);
  }

  return getVSTotalPot(vs);
}

export function hasVSWinner(vs: VSData) {
  return (
    vs.winner_side === "creator" ||
    vs.winner_side === "challengers" ||
    vs.winner !== ZERO_ADDRESS
  );
}

// Mirrors CHALLENGE_LOCK_SECONDS from Mimir.sol — challenges must arrive at least
// this long before the deadline, otherwise the on-chain tx reverts with
// "Mimir: challenge window closed".
export const VS_CHALLENGE_LOCK_SECONDS = 60;

export function isVSJoinable(vs: VSData, address?: string | null) {
  if (vs.state !== "open" && vs.state !== "accepted") return false;
  if (address) {
    if (isSameAddress(vs.creator, address) || didUserChallengeVS(vs, address)) return false;
  }
  if (getVSChallengerCount(vs) >= getVSConfiguredMaxChallengers(vs)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (vs.deadline > 0 && nowSec + VS_CHALLENGE_LOCK_SECONDS > vs.deadline) return false;
  return true;
}

export function didUserChallengeVS(vs: VSData, address?: string | null) {
  if (!address) return false;
  if ((vs.challenger_addresses ?? []).some((a) => isSameAddress(a, address))) return true;
  return vs.opponent !== ZERO_ADDRESS && isSameAddress(vs.opponent, address);
}

export function didUserWinVS(vs: VSData, address?: string | null) {
  if (!address || !hasVSWinner(vs)) return false;
  if (vs.winner_side === "creator") return isSameAddress(vs.creator, address);
  if (vs.winner_side === "challengers") return didUserChallengeVS(vs, address);
  return isSameAddress(vs.winner, address);
}

export function didUserLoseVS(vs: VSData, address?: string | null) {
  if (!address || !hasVSWinner(vs)) return false;
  const involved = isSameAddress(vs.creator, address) || didUserChallengeVS(vs, address);
  return involved && !didUserWinVS(vs, address);
}

function getVSUserChallenger(vs: VSData, address?: string | null) {
  if (!address) return null;
  return (vs.challengers ?? []).find((challenger) =>
    isSameAddress(challenger.address, address)
  ) ?? null;
}

function getVSUserChallengerStake(vs: VSData, address?: string | null): number {
  const challenger = getVSUserChallenger(vs, address);
  if (challenger && Number.isFinite(challenger.stake)) return challenger.stake;
  const n = Math.max(1, getVSChallengerCount(vs));
  if ((vs.total_challenger_stake ?? 0) > 0) {
    return n <= 1 ? vs.total_challenger_stake! : vs.total_challenger_stake! / n;
  }
  return vs.stake_amount ?? 0;
}

export function getVSUserCommittedStake(vs: VSData, address?: string | null): number {
  if (!address) return 0;
  if (isSameAddress(vs.creator, address)) {
    return vs.creator_stake ?? vs.stake_amount ?? 0;
  }
  if (!didUserChallengeVS(vs, address)) return 0;
  return getVSUserChallengerStake(vs, address);
}

export function getVSUserWinAmount(vs: VSData, address?: string | null) {
  if (!didUserWinVS(vs, address)) return 0;
  if (vs.winner_side === "creator") return getVSTotalPot(vs);
  if (vs.winner_side === "challengers") {
    const challenger = getVSUserChallenger(vs, address);
    if (challenger && Number.isFinite(challenger.potential_payout)) {
      return challenger.potential_payout;
    }

    const stake = getVSUserChallengerStake(vs, address);
    if (vs.odds_mode === "fixed" && (vs.challenger_payout_bps ?? 0) > 0) {
      return (stake * vs.challenger_payout_bps!) / BPS_DIVISOR;
    }

    const totalChallengerStake = vs.total_challenger_stake ?? stake;
    const creatorStake = vs.creator_stake ?? vs.stake_amount ?? 0;
    if (totalChallengerStake <= 0) return stake;
    return stake + (stake * creatorStake) / totalChallengerStake;
  }
  return getVSTotalPot(vs);
}

// ── Legacy aliases (backwards compat with VS detail/create pages) ─────────────

/** Alias for challengeClaim — kept for page compatibility */
export async function acceptVS(
  wallet: string,
  claimId: number,
  stakeAmount: number,
  inviteKey = "",
  chain: ChainKey = "arc",
): Promise<ClaimWriteResult> {
  return challengeClaim(wallet, claimId, stakeAmount, inviteKey, chain);
}

// ── Server-layer aliases (used by lib/server/vs-cache.ts + vs-index.ts) ──────

/** Returns open/active public claims as VSData[], across chains. */
export async function getOpenVSSummaries(): Promise<VSData[]> {
  return (await getOpenClaimSummaries()).map(mapClaimToVS);
}

/** Returns paginated claims as ClaimData (for server-side indexer). */
export async function getClaimSummaries(
  startId: number,
  limit: number,
  chain: ChainKey = "arc",
): Promise<ClaimData[]> {
  const results = await readClaimsRange(startId, limit, chain);
  return results.filter(Boolean) as ClaimData[];
}

/** Returns a single claim, optionally checking invite key. */
export async function getClaimWithAccess(
  claimId: number,
  _inviteKey?: string,
  chain: ChainKey = "arc",
): Promise<ClaimData | null> {
  return readClaimRaw(claimId, chain);
}

/** Returns open/active public claims as ClaimData, across chains. */
export async function getOpenClaimSummaries(): Promise<ClaimData[]> {
  return (await readAllChains()).filter(
    (c) => (c.state === "open" || c.state === "active") && !c.is_private
  );
}

/** Returns claims for a user as ClaimData, across chains. */
export async function getUserClaimSummaries(address: string): Promise<ClaimData[]> {
  return (await readAllChains()).filter((c) => involves(c, address));
}

/** @deprecated use getAllVSFast */
export async function getAllVSSnapshot(
  opts?: { forceRefresh?: boolean }
): Promise<VSFeedSnapshot> {
  // In the browser this MUST go through /api/vs (the indexed cache): reading
  // every claim directly from the public Arc RPC (~3 calls per claim) trips
  // its per-client rate limit and the whole feed comes back empty.
  if (typeof window !== "undefined") {
    const res = await fetch(opts?.forceRefresh ? "/api/vs?refresh=1" : "/api/vs");
    if (!res.ok) throw new Error(`/api/vs returned ${res.status}`);
    const data = await res.json();
    return { items: data.items ?? [], cache: data.cache ?? null };
  }
  return getAllVSDirect();
}

/** @deprecated use getUserVSFast */
export async function getUserVSSnapshot(
  address: string,
  opts?: { forceRefresh?: boolean }
): Promise<VSFeedSnapshot> {
  if (typeof window !== "undefined") {
    const suffix = opts?.forceRefresh ? "?refresh=1" : "";
    const res = await fetch(`/api/vs/user/${address}${suffix}`);
    if (!res.ok) throw new Error(`/api/vs/user returned ${res.status}`);
    const data = await res.json();
    return { items: data.items ?? [], cache: data.cache ?? null };
  }
  const items = await getUserVSSummaries(address);
  return { items: items.sort(byNewest), cache: makeLiveFreshness() };
}

/** Alias for cancelClaim — kept for page compatibility */
export async function cancelVS(
  wallet: string,
  claimId: number,
  _inviteKey = "",
  chain: ChainKey = "arc",
): Promise<ClaimWriteResult> {
  return cancelClaim(wallet, claimId, chain);
}

/** Alias for getUserVSSummaries — kept for page compatibility */
export async function getUserVSDirect(address: string): Promise<VSData[]> {
  return getUserVSSummaries(address);
}

/**
 * Traverse parent_id chain to build a rivalry chain.
 * Returns an array of claim IDs from root → all descendants (BFS).
 */
export async function getRivalryChain(claimId: number, chain: ChainKey = "arc"): Promise<number[]> {
  const visited = new Set<number>();
  const queue   = [claimId];
  const result: number[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);

    const claim = await readClaimRaw(id, chain);
    if (!claim) continue;

    // Walk up to root
    if (claim.parent_id > 0 && !visited.has(claim.parent_id)) {
      queue.unshift(claim.parent_id);
    }
  }

  return result;
}

/**
 * On Arc, resolution is handled by the off-chain oracle agent automatically.
 * This stub is kept for UI compatibility — it no longer sends a transaction.
 */
export async function requestResolveVS(
  _wallet: string,
  _claimId: number,
  _inviteKey = ""
): Promise<ClaimWriteResult> {
  throw new Error(
    "Resolution is handled automatically by the Mimir oracle agent after the deadline. No user action required."
  );
}

/** Kept for UI compatibility — no-op on Arc. */
export async function resetVSResolveRequest(
  _wallet: string,
  _claimId: number,
  _inviteKey = ""
): Promise<ClaimWriteResult> {
  throw new Error("Not applicable on Arc — oracle resolves automatically.");
}
