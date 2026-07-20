/**
 * Mimir contract client (Arc / viem)
 *
 * USDC is the native currency on Arc (6 decimals, like ETH on Ethereum).
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  stringToBytes,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  arcTestnet,
  getArcRpcUrl,
  getContractAddress,
  getExplorerTxUrl,
  ensureArcChain,
  usdcToWei,
  weiToUsdc,
  RPC_BATCH_SIZE,
} from "./arc";
import { MIMIR_ABI, STATE, WINNER_SIDE, BPS_DIVISOR } from "./mimir-abi";
import { normalizeCategoryId, ZERO_ADDRESS } from "./constants";
import { decodeClaimTuple } from "./claim-codec";
import type { VSCacheFreshness } from "./vs-freshness";

// ── Constants ─────────────────────────────────────────────────────────────────
// MIN_STAKE in display USDC (matches Mimir.sol: 2 * 10^18 wei = 2 USDC)

export const CONTRACT_ADDRESS = getContractAddress();

// ── Interfaces ────────────────────────────────────────────────────────────────
export interface ClaimChallenger {
  address: string;
  stake: number;
  potential_payout: number;
}

export interface ClaimData {
  id: number;
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

// ── viem public client (singleton per process) ────────────────────────────────
// Uses the same JSON-RPC batching transport as createArcPublicClient — see
// lib/arc.ts ARC_HTTP_OPTS for the rationale.
let _publicClient: PublicClient | null = null;
function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(getArcRpcUrl(), {
        batch: { batchSize: RPC_BATCH_SIZE, wait: 16 },
        retryCount: 3,
        retryDelay: 300,
        timeout: 20_000,
      }),
    }) as PublicClient;
  }
  return _publicClient;
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

async function readClaimsRange(startId: number, count: number): Promise<(ClaimData | null)[]> {
  const ids = Array.from({ length: count }, (_, i) => startId + i);
  return mapWithConcurrency(ids, (id) => readClaimRaw(id));
}

// ── Raw on-chain read ─────────────────────────────────────────────────────────
const READ_CLAIM_RETRY_ATTEMPTS = 3;
const READ_CLAIM_RETRY_BASE_MS = 200;

async function readClaimContractTriplet(client: PublicClient, claimId: number) {
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

export async function readClaimRaw(claimId: number): Promise<ClaimData | null> {
  const client = getPublicClient();
  let base: readonly any[] | null = null;
  let market: readonly any[] | null = null;
  let challengerData: [string[], bigint[]] | null = null;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < READ_CLAIM_RETRY_ATTEMPTS; attempt += 1) {
    try {
      [base, market, challengerData] = await readClaimContractTriplet(client, claimId);
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
      console.warn(`[readClaimRaw] claim ${claimId} failed after ${READ_CLAIM_RETRY_ATTEMPTS} attempts`, lastError);
    }
    return null;
  }

  try {
    const decoded = decodeClaimTuple(claimId, base, market);
    if (!decoded) return null;

    const creatorStakeUsdc = weiToUsdc(decoded.creatorStake);
    const totalChStakeUsdc = weiToUsdc(decoded.totalChallengerStake);
    const reservedUsdc     = weiToUsdc(decoded.reservedCreatorLiability);

    const [chAddrs, chStakes] = challengerData;
    const payBps  = Number(decoded.challengerPayoutBps);
    const isFixed = decoded.oddsMode === "fixed";
    const challengers: ClaimChallenger[] = chAddrs.map((addr, i) => {
      const stake  = weiToUsdc(chStakes[i]);
      const payout = isFixed
        ? (stake * payBps) / BPS_DIVISOR
        : stake + (totalChStakeUsdc > 0 ? (stake / totalChStakeUsdc) * creatorStakeUsdc : 0);
      return { address: addr, stake, potential_payout: payout };
    });

    const availLiab = Math.max(0, creatorStakeUsdc - reservedUsdc);

    return {
      id:                         claimId,
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
export async function getClaim(claimId: number): Promise<ClaimData | null> {
  return readClaimRaw(claimId);
}

export async function getClaimCount(): Promise<number> {
  const client = getPublicClient();
  const count = await client.readContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: "claimCount",
  }) as bigint;
  return Number(count);
}

export async function getVSSummaries(startId: number, limit: number): Promise<VSData[]> {
  const results = await readClaimsRange(startId, limit);
  return (results.filter(Boolean) as ClaimData[]).map(mapClaimToVS);
}

export async function getUserVSSummaries(address: string): Promise<VSData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];

  const all = await readClaimsRange(1, count);

  const addr = address.toLowerCase();
  return all
    .filter((c): c is ClaimData => {
      if (!c) return false;
      const isCreator    = c.creator.toLowerCase() === addr;
      const isChallenger = (c.challenger_addresses ?? []).some(
        (a) => a.toLowerCase() === addr
      );
      return isCreator || isChallenger;
    })
    .map(mapClaimToVS);
}

export async function getUserStats(address: string): Promise<{ wins: number; losses: number }> {
  const client = getPublicClient();
  const [wins, losses] = (await client.readContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: "getUserStats",
    args:         [address as `0x${string}`],
  })) as [bigint, bigint];
  return { wins: Number(wins), losses: Number(losses) };
}

export async function getPlatformStats(): Promise<{
  total_claims: number;
  total_resolved: number;
  total_pool: number;
}> {
  const client = getPublicClient();
  const [totalClaims, resolved, balance] = (await client.readContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: "getPlatformStats",
  })) as [bigint, bigint, bigint];
  return {
    total_claims:   Number(totalClaims),
    total_resolved: Number(resolved),
    total_pool:     weiToUsdc(balance),
  };
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
  const count = await getClaimCount();
  if (count <= 0) return { items: [], cache: makeLiveFreshness() };

  // Single concurrency-limited read across all IDs — paginating then
  // Promise.all-ing pages just multiplied the concurrent request burst by
  // page-count and was the main 429 source on Arc.
  const all = await readClaimsRange(1, count);
  return {
    items: (all.filter(Boolean) as ClaimData[])
      .map(mapClaimToVS)
      .sort((a, b) => b.id - a.id),
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
  return { items: items.sort((a, b) => b.id - a.id), cache: makeLiveFreshness() };
}

/** Returns VSData | null directly (backwards compatible). */
export async function getVS(
  vsId: number,
  opts?: { inviteKey?: string; viewerAddress?: string }
): Promise<VSData | null> {
  if (typeof window !== "undefined") {
    const url = opts?.inviteKey
      ? `/api/vs/${vsId}?invite=${encodeURIComponent(opts.inviteKey)}`
      : `/api/vs/${vsId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.item ?? null;
  }
  const claim = await readClaimRaw(vsId);
  return claim ? mapClaimToVS(claim) : null;
}

/** Returns VSDetailSnapshot with cache metadata. */
export async function getVSFull(
  vsId: number,
  opts?: { inviteKey?: string; viewerAddress?: string }
): Promise<VSDetailSnapshot> {
  if (typeof window !== "undefined") {
    const url = opts?.inviteKey
      ? `/api/vs/${vsId}?invite=${encodeURIComponent(opts.inviteKey)}`
      : `/api/vs/${vsId}`;
    const res = await fetch(url);
    if (!res.ok) return { item: null, cache: null };
    const data = await res.json();
    return { item: data.item ?? null, cache: data.cache ?? null };
  }
  const claim = await readClaimRaw(vsId);
  return { item: claim ? mapClaimToVS(claim) : null, cache: makeLiveFreshness() };
}

// ── Write: browser (wagmi / injected wallet) ──────────────────────────────────
async function sendBrowserTx(
  functionName: string,
  args: unknown[],
  valueUsdc: number
): Promise<ContractWriteResult> {
  const ethereum =
    typeof window !== "undefined" ? (window as any).ethereum : undefined;
  if (!ethereum) throw new Error("No wallet connected. Please connect a wallet first.");

  await ensureArcChain(ethereum);

  const accounts: string[] = await ethereum.request({ method: "eth_accounts" });
  if (!accounts.length) throw new Error("Wallet not connected");

  const wc = createWalletClient({
    chain:     arcTestnet,
    transport: custom(ethereum),
    account:   accounts[0] as `0x${string}`,
  });

  const valueMicro = usdcToWei(valueUsdc);

  const txHash = await wc.writeContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: functionName as any,
    args:         args as any,
    // value cast: with functionName widened to `any`, viem unions all ABI
    // entries and collapses `value` to `undefined` (nonpayable fns like
    // withdraw exist alongside payable createClaim/challengeClaim).
    value:        valueMicro as any,
    account:      accounts[0] as `0x${string}`,
    chain:        arcTestnet,
  });

  // Arc has sub-second finality — receipt arrives quickly
  try {
    const receipt = await Promise.race([
      getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 30_000)),
    ]);
    if ((receipt as any).status === "reverted") throw new Error("Transaction reverted");
    const explorerUrl = getExplorerTxUrl(txHash);
    return { txHash, explorerUrl, explorerTxHash: explorerUrl, receipt, pending: false };
  } catch (err: any) {
    if (err?.message === "Transaction reverted") throw err;
    const explorerUrl = getExplorerTxUrl(txHash);
    return { txHash, explorerUrl, explorerTxHash: explorerUrl, receipt: null, pending: true };
  }
}

// ── Write: server (private key) ───────────────────────────────────────────────
async function sendServerTx(
  privateKey: string,
  functionName: string,
  args: unknown[],
  valueUsdc: number
): Promise<ContractWriteResult> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    chain:     arcTestnet,
    transport: http(getArcRpcUrl()),
    account,
  });

  const valueMicro = usdcToWei(valueUsdc);

  const txHash = await walletClient.writeContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: functionName as any,
    args:         args as any,
    value:        valueMicro as any, // see sendBrowserTx: widened union collapses value to undefined
    account,
    chain:        arcTestnet,
  });

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") throw new Error("Transaction reverted");
  return { txHash, explorerUrl: getExplorerTxUrl(txHash), receipt };
}

// ── Write: demo relay (via server API) ───────────────────────────────────────
async function sendDemoTx(
  action: string,
  params: Record<string, unknown>
): Promise<ContractWriteResult & { claimId: number | null }> {
  const res = await fetch("/api/demo/write", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action, params }),
  });
  if (!res.ok) throw new Error(`Demo relay error: ${res.status}`);
  const data = await res.json();
  return {
    txHash:    data.txHash ?? "",
    explorerUrl: data.txHash ? getExplorerTxUrl(data.txHash) : undefined,
    receipt:   null,
    pending:   data.pending ?? false,
    claimId:   data.claimId ?? null,
  };
}

// ── Public write functions ────────────────────────────────────────────────────
export async function createClaim(
  wallet: string,
  params: CreateClaimParams
): Promise<ClaimWriteResult> {
  const args = buildCreateArgs(params);

  if (isDemoMode()) {
    return sendDemoTx("create_claim", params as unknown as Record<string, unknown>);
  }

  const result = await sendBrowserTx("createClaim", args, params.stake_amount);
  const count  = await getClaimCount().catch(() => null);
  return { ...result, claimId: count };
}

export async function challengeClaim(
  wallet: string,
  claimId: number,
  stakeAmount: number,
  inviteKey = ""
): Promise<ClaimWriteResult> {
  if (isDemoMode()) {
    return sendDemoTx("challenge_claim", { claimId, stakeAmount, inviteKey });
  }
  const result = await sendBrowserTx(
    "challengeClaim",
    [BigInt(claimId), usdcToWei(stakeAmount), inviteKey],
    stakeAmount
  );
  return { ...result, claimId };
}

export async function resolveClaim(
  wallet: string,
  claimId: number
): Promise<ClaimWriteResult> {
  if (isDemoMode()) {
    return sendDemoTx("resolve_claim", { claimId });
  }
  // Browser resolution is not supported — resolution is oracle-only on Arc.
  // This path allows demo/test only.
  throw new Error(
    "Claims are resolved by the Mimir oracle agent. Connect as oracle to resolve manually."
  );
}

export async function cancelClaim(
  wallet: string,
  claimId: number
): Promise<ClaimWriteResult> {
  if (isDemoMode()) {
    return sendDemoTx("cancel_claim", { claimId });
  }
  const result = await sendBrowserTx("cancelClaim", [BigInt(claimId)], 0);
  return { ...result, claimId };
}

export async function createRematch(
  wallet: string,
  parentId: number,
  params: Pick<CreateClaimParams, "deadline" | "stake_amount" | "invite_key">
): Promise<ClaimWriteResult> {
  if (isDemoMode()) {
    return sendDemoTx("create_rematch", { parentId, ...params });
  }
  const result = await sendBrowserTx(
    "createRematch",
    [BigInt(parentId), BigInt(params.deadline), usdcToWei(params.stake_amount), params.invite_key ?? ""],
    params.stake_amount
  );
  const count = await getClaimCount().catch(() => null);
  return { ...result, claimId: count };
}

// ── Server-side demo write ────────────────────────────────────────────────────
export async function executeDemoWrite(
  action: string,
  params: Record<string, unknown>
): Promise<ClaimWriteResult> {
  const privateKey = getDemoPrivateKey(action);
  if (!privateKey) throw new Error(`No demo key configured for action: ${action}`);

  if (action === "create_claim") {
    const p = params as unknown as CreateClaimParams;
    const args = buildCreateArgs(p);
    const result = await sendServerTx(privateKey, "createClaim", args, p.stake_amount);
    const count  = await getClaimCount().catch(() => null);
    return { ...result, claimId: count };
  }

  if (action === "challenge_claim") {
    const { claimId, stakeAmount, inviteKey = "" } = params as any;
    const result = await sendServerTx(
      privateKey, "challengeClaim",
      [BigInt(claimId), usdcToWei(stakeAmount), inviteKey],
      stakeAmount
    );
    return { ...result, claimId: Number(claimId) };
  }

  if (action === "resolve_claim") {
    // Demo resolve: oracle agent handles real resolution; demo just simulates
    const { claimId } = params as any;
    throw new Error(`Claim ${claimId}: use the oracle agent to resolve on Arc.`);
  }

  if (action === "cancel_claim") {
    const { claimId } = params as any;
    const result = await sendServerTx(privateKey, "cancelClaim", [BigInt(claimId)], 0);
    return { ...result, claimId: Number(claimId) };
  }

  if (action === "create_rematch") {
    const { parentId, deadline, stake_amount, invite_key = "" } = params as any;
    const result = await sendServerTx(
      privateKey, "createRematch",
      [BigInt(parentId), BigInt(deadline), usdcToWei(stake_amount), invite_key],
      stake_amount
    );
    const count = await getClaimCount().catch(() => null);
    return { ...result, claimId: count };
  }

  throw new Error(`Unknown demo action: ${action}`);
}

// ── Helper: build createClaim args tuple ──────────────────────────────────────
function buildCreateArgs(p: CreateClaimParams): unknown[] {
  return [
    p.question,
    p.creator_position,
    p.counter_position,
    p.resolution_url,
    BigInt(p.deadline),
    usdcToWei(p.stake_amount),
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
function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "1";
}

function getDemoPrivateKey(action: string): string | undefined {
  if (action === "create_claim" || action === "create_rematch") {
    return process.env.DEMO_CREATOR_PRIVATE_KEY || process.env.DEMO_SIGNER_PRIVATE_KEY;
  }
  if (action === "challenge_claim") {
    return process.env.DEMO_CHALLENGER_PRIVATE_KEY || process.env.DEMO_SIGNER_PRIVATE_KEY;
  }
  return process.env.DEMO_SIGNER_PRIVATE_KEY;
}

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
  inviteKey = ""
): Promise<ClaimWriteResult> {
  return challengeClaim(wallet, claimId, stakeAmount, inviteKey);
}

// ── Server-layer aliases (used by lib/server/vs-cache.ts + vs-index.ts) ──────

/** Returns open/active public claims as VSData[]. */
export async function getOpenVSSummaries(): Promise<VSData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];
  const all = await readClaimsRange(1, count);
  return (all.filter(Boolean) as ClaimData[])
    .filter((c) => (c.state === "open" || c.state === "active") && !c.is_private)
    .map(mapClaimToVS);
}

/** Returns paginated claims as ClaimData (for server-side indexer). */
export async function getClaimSummaries(startId: number, limit: number): Promise<ClaimData[]> {
  const results = await readClaimsRange(startId, limit);
  return results.filter(Boolean) as ClaimData[];
}

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Returns a single claim. For private claims the caller MUST supply the invite
 * key: it's hashed and compared to the on-chain inviteKeyHash, and a mismatch
 * returns null. Without this check any well-formed string would unlock the
 * claim's private content (IDOR).
 */
export async function getClaimWithAccess(
  claimId: number,
  inviteKey?: string
): Promise<ClaimData | null> {
  const claim = await readClaimRaw(claimId);
  if (!claim) return null;

  if (!claim.is_private) return claim;

  const expected = (await getInviteKeyHash(claimId)).toLowerCase();
  // No commitment on-chain → treat as inaccessible rather than open.
  if (!expected || expected === ZERO_HASH) return null;
  if (!inviteKey) return null;

  const provided = keccak256(stringToBytes(inviteKey)).toLowerCase();
  return provided === expected ? claim : null;
}

async function getInviteKeyHash(claimId: number): Promise<string> {
  const client = getPublicClient();
  return (await client.readContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: "getInviteKeyHash",
    args:         [BigInt(claimId)],
  })) as string;
}

/** Returns open/active public claims as ClaimData. */
export async function getOpenClaimSummaries(): Promise<ClaimData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];
  const all = await readClaimsRange(1, count);
  return (all.filter(Boolean) as ClaimData[]).filter(
    (c) => (c.state === "open" || c.state === "active") && !c.is_private
  );
}

/** Returns claims for a user as ClaimData. */
export async function getUserClaimSummaries(address: string): Promise<ClaimData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];
  const all = await readClaimsRange(1, count);
  const addr = address.toLowerCase();
  return (all.filter(Boolean) as ClaimData[]).filter((c) => {
    const isCreator    = c.creator.toLowerCase() === addr;
    const isChallenger = (c.challenger_addresses ?? []).some((a) => a.toLowerCase() === addr);
    return isCreator || isChallenger;
  });
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
  return { items: items.sort((a, b) => b.id - a.id), cache: makeLiveFreshness() };
}

/** Alias for cancelClaim — kept for page compatibility */
export async function cancelVS(
  wallet: string,
  claimId: number,
  _inviteKey = ""
): Promise<ClaimWriteResult> {
  return cancelClaim(wallet, claimId);
}

/** Alias for getUserVSSummaries — kept for page compatibility */
export async function getUserVSDirect(address: string): Promise<VSData[]> {
  return getUserVSSummaries(address);
}

/**
 * Traverse parent_id chain to build a rivalry chain.
 * Returns an array of claim IDs from root → all descendants (BFS).
 */
export async function getRivalryChain(claimId: number): Promise<number[]> {
  const visited = new Set<number>();
  const queue   = [claimId];
  const result: number[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);

    const claim = await readClaimRaw(id);
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
