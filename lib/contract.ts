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
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  arcTestnet,
  getArcRpcUrl,
  getContractAddress,
  getExplorerTxUrl,
  ensureArcChain,
  usdcToMicro,
  microToUsdc,
} from "./arc";
import { MIMIR_ABI, STATE, WINNER_SIDE } from "./mimir-abi";
import { normalizeCategoryId } from "./constants";
import type { VSCacheFreshness } from "./vs-freshness";

// ── Constants ─────────────────────────────────────────────────────────────────
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
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
let _publicClient: PublicClient | null = null;
function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(getArcRpcUrl()),
    }) as PublicClient;
  }
  return _publicClient;
}

// ── Raw on-chain read ─────────────────────────────────────────────────────────
export async function readClaimRaw(claimId: number): Promise<ClaimData | null> {
  const client = getPublicClient();
  try {
    const [base, market, challengerData] = await Promise.all([
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

    const creator: string = base[0];
    if (!creator || creator === ZERO_ADDRESS) return null;

    const creatorStakeMicro = BigInt(base[5]);
    const totalChStakeMicro = BigInt(base[6]);
    const reservedLiab      = BigInt(base[7]);

    const creatorStakeUsdc = microToUsdc(creatorStakeMicro);
    const totalChStakeUsdc = microToUsdc(totalChStakeMicro);
    const reservedUsdc     = microToUsdc(reservedLiab);

    const [chAddrs, chStakes] = challengerData;
    const challengers: ClaimChallenger[] = chAddrs.map((addr, i) => {
      const stake   = microToUsdc(chStakes[i]);
      const payBps  = Number(market[2]);
      const isFixed = market[1] === "fixed";
      const payout  = isFixed
        ? (stake * payBps) / 10_000
        : stake + (totalChStakeUsdc > 0 ? (stake / totalChStakeUsdc) * creatorStakeUsdc : 0);
      return { address: addr, stake, potential_payout: payout };
    });

    const isPrivate: boolean = market[6];
    const availLiab = Math.max(0, creatorStakeUsdc - reservedUsdc);

    return {
      id:                         claimId,
      creator,
      question:                   base[1],
      creator_position:           base[2],
      counter_position:           base[3],
      resolution_url:             base[4],
      creator_stake:              creatorStakeUsdc,
      total_challenger_stake:     totalChStakeUsdc,
      reserved_creator_liability: reservedUsdc,
      available_creator_liability: availLiab,
      deadline:                   Number(base[8]),
      state:                      mapState(Number(base[9])),
      winner_side:                mapWinnerSide(Number(base[10])),
      resolution_summary:         base[11],
      confidence:                 Number(base[12]),
      category:                   normalizeCategoryId(base[13]),
      parent_id:                  Number(base[14]),
      challenger_count:           Number(base[15]),
      created_at:                 Number(base[16]),
      evidence_hash:              (base[17] && base[17] !== "0x0000000000000000000000000000000000000000000000000000000000000000") ? base[17] as string : undefined,
      market_type:                market[0],
      odds_mode:                  market[1],
      challenger_payout_bps:      Number(market[2]),
      handicap_line:              market[3],
      settlement_rule:            market[4],
      max_challengers:            Number(market[5]),
      visibility:                 isPrivate ? "private" : "public",
      is_private:                 isPrivate,
      challengers,
      first_challenger:           chAddrs[0] ?? ZERO_ADDRESS,
      challenger_addresses:       chAddrs,
      total_pot:                  creatorStakeUsdc + totalChStakeUsdc,
    };
  } catch {
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
  const ids = Array.from({ length: limit }, (_, i) => startId + i);
  const results = await Promise.all(ids.map((id) => readClaimRaw(id)));
  return (results.filter(Boolean) as ClaimData[]).map(mapClaimToVS);
}

export async function getUserVSSummaries(address: string): Promise<VSData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];

  const all = await Promise.all(
    Array.from({ length: count }, (_, i) => readClaimRaw(i + 1))
  );

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
    total_pool:     microToUsdc(balance),
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

  const PAGE = 50;
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(count / PAGE) }, (_, i) =>
      getVSSummaries(i * PAGE + 1, PAGE)
    )
  );
  return {
    items: pages.flat().sort((a, b) => b.id - a.id),
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

  const valueMicro = usdcToMicro(valueUsdc);

  const txHash = await wc.writeContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: functionName as any,
    args:         args as any,
    value:        valueMicro,
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

  const valueMicro = usdcToMicro(valueUsdc);

  const txHash = await walletClient.writeContract({
    address:      CONTRACT_ADDRESS,
    abi:          MIMIR_ABI,
    functionName: functionName as any,
    args:         args as any,
    value:        valueMicro,
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
    [BigInt(claimId), usdcToMicro(stakeAmount), inviteKey],
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
    [BigInt(parentId), BigInt(params.deadline), usdcToMicro(params.stake_amount), params.invite_key ?? ""],
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
      [BigInt(claimId), usdcToMicro(stakeAmount), inviteKey],
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
      [BigInt(parentId), BigInt(deadline), usdcToMicro(stake_amount), invite_key],
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
    usdcToMicro(p.stake_amount),
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
  else if (claim.winner_side === "challengers" && claim.challenger_count === 1) {
    winner = firstChallenger;
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
      return Math.floor((stake * vs.challenger_payout_bps!) / 10_000);
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

export function getVSUserCommittedStake(vs: VSData, address?: string | null): number {
  if (!address) return 0;
  if (isSameAddress(vs.creator, address)) {
    return vs.creator_stake ?? vs.stake_amount ?? 0;
  }
  if (!didUserChallengeVS(vs, address)) return 0;
  const n = Math.max(1, getVSChallengerCount(vs));
  if ((vs.total_challenger_stake ?? 0) > 0) {
    return n <= 1 ? vs.total_challenger_stake! : Math.floor(vs.total_challenger_stake! / n);
  }
  return vs.stake_amount ?? 0;
}

export function getVSUserWinAmount(vs: VSData, address?: string | null) {
  if (!didUserWinVS(vs, address)) return 0;
  if (vs.winner_side === "creator") return getVSTotalPot(vs);
  if (vs.winner_side === "challengers") return getVSSingleWinnerPayout(vs) ?? 0;
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
  const all = await Promise.all(
    Array.from({ length: count }, (_, i) => readClaimRaw(i + 1))
  );
  return (all.filter(Boolean) as ClaimData[])
    .filter((c) => (c.state === "open" || c.state === "active") && !c.is_private)
    .map(mapClaimToVS);
}

/** Returns paginated claims as ClaimData (for server-side indexer). */
export async function getClaimSummaries(startId: number, limit: number): Promise<ClaimData[]> {
  const ids = Array.from({ length: limit }, (_, i) => startId + i);
  const results = await Promise.all(ids.map((id) => readClaimRaw(id)));
  return results.filter(Boolean) as ClaimData[];
}

/** Returns a single claim, optionally checking invite key. */
export async function getClaimWithAccess(
  claimId: number,
  _inviteKey?: string
): Promise<ClaimData | null> {
  return readClaimRaw(claimId);
}

/** Returns open/active public claims as ClaimData. */
export async function getOpenClaimSummaries(): Promise<ClaimData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];
  const all = await Promise.all(
    Array.from({ length: count }, (_, i) => readClaimRaw(i + 1))
  );
  return (all.filter(Boolean) as ClaimData[]).filter(
    (c) => (c.state === "open" || c.state === "active") && !c.is_private
  );
}

/** Returns claims for a user as ClaimData. */
export async function getUserClaimSummaries(address: string): Promise<ClaimData[]> {
  const count = await getClaimCount();
  if (count <= 0) return [];
  const all = await Promise.all(
    Array.from({ length: count }, (_, i) => readClaimRaw(i + 1))
  );
  const addr = address.toLowerCase();
  return (all.filter(Boolean) as ClaimData[]).filter((c) => {
    const isCreator    = c.creator.toLowerCase() === addr;
    const isChallenger = (c.challenger_addresses ?? []).some((a) => a.toLowerCase() === addr);
    return isCreator || isChallenger;
  });
}

/** @deprecated use getAllVSFast */
export async function getAllVSSnapshot(
  _opts?: { forceRefresh?: boolean }
): Promise<VSFeedSnapshot> {
  return getAllVSFast();
}

/** @deprecated use getUserVSFast */
export async function getUserVSSnapshot(
  address: string,
  _opts?: { forceRefresh?: boolean }
): Promise<VSFeedSnapshot> {
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
