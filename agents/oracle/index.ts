/**
 * Mimir Oracle Agent — AI economic actor on Arc
 *
 * Two roles:
 *   1. SETTLER: resolves expired active claims (pays out winners)
 *   2. CHALLENGER: evaluates open claims early and auto-stakes on mispriced ones
 *
 * This makes the oracle a genuine economic participant — not just a judge,
 * but a player that puts USDC on the line when it's confident.
 *
 * Signs all transactions via Circle W3S (Programmable Wallets) — no local
 * private key. The agent's wallet is held in Circle's custody and authorized
 * by CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET.
 *
 * Run: npx tsx agents/oracle/index.ts
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_WALLET_ID,
 *      CIRCLE_ORACLE_ADDRESS, NEXT_PUBLIC_CONTRACT_ADDRESS
 *      + one of: GEMINI_API_KEY (preferred) OR ANTHROPIC_API_KEY
 *      AUTO_CHALLENGE=1        (enable auto-challenger, default off)
 *      CHALLENGE_STAKE_USDC=2  (stake per challenge, default 2 USDC)
 *      CHALLENGE_CONFIDENCE=80 (min confidence to challenge, default 80)
 *      ORACLE_LLM_THROTTLE_MS=0 (min ms between LLM calls; raise to stay
 *                                under free-tier RPM, e.g. 5000 ≈ 12 RPM)
 *      ORACLE_POLL_INTERVAL_MS=60000 (poll cadence in ms, default 60s)
 */

// Worker-scoped Gemini key. When ORACLE_GEMINI_API_KEY is set we override the
// shared GEMINI_API_KEY for this process only so the oracle, market-creator,
// and council each consume from their own 20 RPM free-tier bucket. Trimmed on
// assignment so trailing whitespace pasted into the Railway UI can't slip into
// the Authorization header and trigger API_KEY_INVALID.
{
  const k = process.env.ORACLE_GEMINI_API_KEY?.trim();
  if (k) process.env.GEMINI_API_KEY = k;
}

import { keccak256, toBytes, formatEther } from "viem";
import { callLLM, activeLLMProvider, activeLLMModel, activeLLMKeyFingerprint, pickGeminiModel } from "../../lib/llm";
import {
  createArcPublicClient,
  arcTestnet,
  microToUsdc,
  usdcToMicro,
  getContractAddress,
  getExplorerTxUrl,
} from "../../lib/arc";
import {
  executeContract,
  buildAbiFunctionSignature,
  toCircleAbiParameters,
  getOracleWalletId,
  getOracleAddress,
} from "../../lib/circle-w3s";
import { MIMIR_ABI, WINNER_SIDE, STATE } from "../../lib/mimir-abi";
import {
  fetchEvidence as fetchEvidenceShared,
  EvidenceFetchError,
  type EvidenceFetcherKind,
  type EvidencePayment,
} from "../../lib/server/evidence-fetcher";
import { fetchWithBudget, usdcToAtomic } from "../../lib/x402";
import { gatherCouncilVerdict } from "./council-vote";

// ── Config ────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS      = Number(process.env.ORACLE_POLL_INTERVAL_MS ?? "60000");
const MAX_CONTENT_CHARS     = 8_000;
const CONTRACT_ADDRESS      = getContractAddress();
const AUTO_CHALLENGE        = process.env.AUTO_CHALLENGE === "1";
const CHALLENGE_STAKE_USDC  = Number(process.env.CHALLENGE_STAKE_USDC ?? "2");
const CHALLENGE_CONFIDENCE  = Number(process.env.CHALLENGE_CONFIDENCE ?? "80");
const LLM_THROTTLE_MS       = Number(process.env.ORACLE_LLM_THROTTLE_MS ?? "8000");

// x402 paid-evidence config. The oracle becomes a PAYING agent: when a resolution
// source answers 402, it buys the data with a sub-cent USDC nanopayment — but
// only up to a budget tied to what's actually at stake on the claim.
const PAY_EVIDENCE        = process.env.PAY_EVIDENCE !== "0"; // on by default
const EVIDENCE_POOL_BPS   = Number(process.env.EVIDENCE_POOL_BPS ?? "50");   // 0.5% of pot
const EVIDENCE_MAX_USDC   = Number(process.env.EVIDENCE_MAX_USDC ?? "0.05"); // hard ceiling
const EVIDENCE_MIN_USDC   = Number(process.env.EVIDENCE_MIN_USDC ?? "0.001");// floor (still pay tiny sources)

// Council-as-jury settlement. When on, the oracle buys each eligible persona's
// verdict via x402 (paid into the persona's wallet) and settles by their tally
// — multi-agent consensus, on-chain. Falls back to the solo verdict if too few
// jurors vote. Off by default so a missing web server never blocks settlement.
const COUNCIL_SETTLEMENT  = process.env.COUNCIL_SETTLEMENT === "1";
const COUNCIL_BASE_URL    = process.env.MIMIR_BASE_URL ?? "http://localhost:3000";
const COUNCIL_QUORUM      = Number(process.env.COUNCIL_QUORUM ?? "3");
const COUNCIL_VOTE_CAP    = Number(process.env.COUNCIL_VOTE_CAP_USDC ?? "0.005");
const SETTLEMENT_DELAY_MS = Number(process.env.ORACLE_SETTLEMENT_DELAY_MS ?? "900000");

// Module-scoped throttle gate. Free-tier Gemini is 5 RPM on new accounts and
// the oracle has no other rate limiter — every claim in a poll fires an LLM
// call back-to-back. ORACLE_LLM_THROTTLE_MS spreads them so RPM stays under
// the quota (e.g. 5000ms ≈ 12 RPM, fits a 15 RPM bucket with headroom).
let lastLlmCallAt = 0;
async function throttledLLM(
  ...args: Parameters<typeof callLLM>
): Promise<string> {
  if (LLM_THROTTLE_MS > 0) {
    const wait = LLM_THROTTLE_MS - (Date.now() - lastLlmCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastLlmCallAt = Date.now();
  return callLLM(...args);
}

// Track challenged claims so we don't double-challenge across polls
const challengedClaimIds = new Set<number>();
// Track evaluated-but-not-challenged (to avoid repeated LLM calls)
const evaluatedClaimIds = new Set<number>();

for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_WALLET_ID", "CIRCLE_ORACLE_ADDRESS"]) {
  if (!process.env[v]) {
    console.error(`${v} env var is required`);
    process.exit(1);
  }
}
if (
  !process.env.GEMINI_API_KEY?.trim() &&
  !process.env.ANTHROPIC_API_KEY?.trim() &&
  !process.env.GROQ_API_KEY?.trim() &&
  !process.env.GROQ_API_KEYS?.trim() &&
  !process.env.OPENROUTER_API_KEY?.trim()
) {
  console.error("Set at least one LLM key: GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY/GROQ_API_KEYS, or OPENROUTER_API_KEY");
  process.exit(1);
}

// Pre-compute Circle ABI signatures (call once, reuse per claim)
const SIG_RESOLVE_CLAIM    = buildAbiFunctionSignature("resolveClaim", MIMIR_ABI);
const SIG_CHALLENGE_CLAIM  = buildAbiFunctionSignature("challengeClaim", MIMIR_ABI);

// ── Clients ───────────────────────────────────────────────────────────────────
const publicClient  = createArcPublicClient();
const ORACLE_WALLET = getOracleWalletId();
const ORACLE_ADDR   = getOracleAddress();

// ── Types ─────────────────────────────────────────────────────────────────────
interface ClaimOnChain {
  id:                       number;
  creator:                  string;
  question:                 string;
  creatorPosition:          string;
  counterPosition:          string;
  resolutionUrl:            string;
  creatorStake:             bigint;
  totalChallengerStake:     bigint;
  reservedCreatorLiability: bigint;
  deadline:                 bigint;
  state:                    number;
  winnerSide:               number;
  resolutionSummary:        string;
  confidence:               number;
  category:                 string;
  parentId:                 bigint;
  challengerCount:          bigint;
  createdAt:                bigint;
  marketType:               string;
  oddsMode:                 string;
  challengerPayoutBps:      bigint;
  handicapLine:             string;
  settlementRule:           string;
  maxChallengers:           bigint;
  isPrivate:                boolean;
}

interface OracleVerdict {
  verdict:     "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE";
  confidence:  number;
  explanation: string;
}

// ── Fetch claim from contract ─────────────────────────────────────────────────
async function fetchClaim(claimId: number): Promise<ClaimOnChain | null> {
  try {
    const [base, market] = await Promise.all([
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: MIMIR_ABI,
        functionName: "getClaim", args: [BigInt(claimId)],
      }) as Promise<readonly any[]>,
      publicClient.readContract({
        address: CONTRACT_ADDRESS, abi: MIMIR_ABI,
        functionName: "getClaimMarketConfig", args: [BigInt(claimId)],
      }) as Promise<readonly any[]>,
    ]);

    if (!base[0] || base[0] === "0x0000000000000000000000000000000000000000") {
      return null;
    }

    return {
      id: claimId, creator: base[0],
      question: base[1], creatorPosition: base[2], counterPosition: base[3],
      resolutionUrl: base[4],
      creatorStake: BigInt(base[5]), totalChallengerStake: BigInt(base[6]),
      reservedCreatorLiability: BigInt(base[7]),
      deadline: BigInt(base[8]), state: Number(base[9]),
      winnerSide: Number(base[10]), resolutionSummary: base[11],
      confidence: Number(base[12]), category: base[13],
      parentId: BigInt(base[14]), challengerCount: BigInt(base[15]),
      createdAt: BigInt(base[16]),
      marketType: market[0], oddsMode: market[1],
      challengerPayoutBps: BigInt(market[2]),
      handicapLine: market[3], settlementRule: market[4],
      maxChallengers: BigInt(market[5]), isPrivate: market[6],
    };
  } catch {
    return null;
  }
}

// ── Fetch web evidence ────────────────────────────────────────────────────────
interface EvidenceResult {
  text: string;
  fetcher: EvidenceFetcherKind | "none";
  payment?: EvidencePayment;
}

/**
 * How much the oracle is willing to pay for evidence on THIS claim: a fraction
 * of the pot, clamped between a floor and a hard ceiling. The bigger the stakes,
 * the more it'll pay to read the truth — but never more than EVIDENCE_MAX_USDC.
 * This is the agent's spending judgement, in code.
 */
function evidenceBudgetUsdc(claim: ClaimOnChain): number {
  const potUsdc = microToUsdc(claim.creatorStake + claim.totalChallengerStake);
  const fraction = (potUsdc * EVIDENCE_POOL_BPS) / 10_000;
  return Math.min(EVIDENCE_MAX_USDC, Math.max(EVIDENCE_MIN_USDC, fraction));
}

async function fetchEvidence(claim: ClaimOnChain): Promise<EvidenceResult> {
  const url = claim.resolutionUrl;
  if (!url?.startsWith("http")) {
    return { text: "(No resolution URL provided)", fetcher: "none" };
  }

  // Wire the budgeted paying fetch only when payment is enabled. Evidence-fetcher
  // calls it solely on a 402; free sources never trigger a payment.
  const budgetUsdc = evidenceBudgetUsdc(claim);
  const maxAtomic = usdcToAtomic(budgetUsdc);
  const paidFetch = PAY_EVIDENCE
    ? async (u: string, init?: RequestInit) => {
        const r = await fetchWithBudget(
          u,
          { walletId: ORACLE_WALLET, address: ORACLE_ADDR },
          maxAtomic,
          init,
        );
        return {
          response: r.response,
          payment: r.payment
            ? {
                priceAtomic: r.payment.priceAtomic.toString(),
                asset: r.payment.asset,
                settlement: r.payment.settlement,
              }
            : null,
        };
      }
    : undefined;

  try {
    const snap = await fetchEvidenceShared(url, {
      maxChars: MAX_CONTENT_CHARS,
      userAgent: "Mimir-Oracle/1.0",
      paidFetch,
    });
    return { text: snap.text, fetcher: snap.fetcher, payment: snap.payment };
  } catch (err: any) {
    const msg = err instanceof EvidenceFetchError
      ? err.message
      : (err?.message ?? "unknown");
    return { text: `(Failed to fetch: ${msg})`, fetcher: "none" };
  }
}

// ── LLM evaluation ────────────────────────────────────────────────────────────
async function evaluateClaim(claim: ClaimOnChain, evidence: string): Promise<OracleVerdict> {
  const deadlineDate = new Date(Number(claim.deadline) * 1000).toISOString();
  const nowDate      = new Date().toISOString();
  const potUsdc = microToUsdc(claim.creatorStake + claim.totalChallengerStake);

  const prompt = `You are Mimir, an impartial AI oracle for a USDC prediction market on Arc blockchain.

## Time context (TRUST THIS, ignore your training cutoff)
- Current UTC time: ${nowDate}
- Claim deadline:   ${deadlineDate}
- The deadline IS in the past. You are settling AFTER the deadline.

## Claim
**Question:** ${claim.question}
**Creator position (Side A):** ${claim.creatorPosition}
**Challenger position (Side B):** ${claim.counterPosition}
**Category:** ${claim.category}
**Market type:** ${claim.marketType}${claim.handicapLine ? `\n**Handicap:** ${claim.handicapLine}` : ""}
**Settlement rule:** ${claim.settlementRule || "Use the linked source to determine the outcome."}
**Resolution URL:** ${claim.resolutionUrl}
**Pot:** ${potUsdc.toFixed(2)} USDC

## Web Evidence (fetched now from the resolution URL)
<evidence>
${evidence}
</evidence>

Evaluate whether Side A (creator) or Side B (challengers) is correct based on the evidence above.
Do NOT refuse because of date / deadline concerns — those are handled by the contract.

Return JSON only:
{
  "verdict": "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE",
  "confidence": <0-100>,
  "explanation": "<one paragraph>"
}

- UNRESOLVABLE only if the fetched evidence is missing, ambiguous, or doesn't contain the data needed.
- Be strict about confidence — only go above 80 when evidence is unambiguous.`;

  const text = await throttledLLM(prompt, { maxTokens: 512, jsonOnly: true, model: pickGeminiModel("oracle") });
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as OracleVerdict;
    if (!["CREATOR_WINS","CHALLENGERS_WIN","DRAW","UNRESOLVABLE"].includes(parsed.verdict)) {
      throw new Error("Invalid verdict");
    }
    return {
      verdict: parsed.verdict,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 50))),
      explanation: (parsed.explanation ?? "").slice(0, 500),
    };
  } catch {
    return { verdict: "UNRESOLVABLE", confidence: 0, explanation: "Oracle failed to parse response." };
  }
}

function verdictToSide(verdict: OracleVerdict["verdict"]): number {
  switch (verdict) {
    case "CREATOR_WINS":    return WINNER_SIDE.CREATOR;
    case "CHALLENGERS_WIN": return WINNER_SIDE.CHALLENGERS;
    case "DRAW":            return WINNER_SIDE.DRAW;
    case "UNRESOLVABLE":    return WINNER_SIDE.UNRESOLVABLE;
  }
}

/**
 * Kelly Criterion: f* = (p * b - q) / b
 *   p = probability of winning (confidence/100)
 *   q = 1 - p
 *   b = net odds (payout ratio - 1, e.g. pool odds ≈ 1.0 for even)
 * Returns fraction of bankroll to bet (0–1), capped at 0.25 for safety.
 */
function kellyFraction(confidencePct: number, netOdds = 1.0): number {
  const p = confidencePct / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(0.25, f)); // cap at 25% bankroll
}

/** Hash evidence content for on-chain verification. */
function hashEvidence(evidence: string): `0x${string}` {
  return keccak256(toBytes(evidence));
}

// Confidence tiers govern how the oracle commits a verdict.
// HIGH      → settle as the LLM said.
// MEDIUM    → still settle, but the explanation gets a [CONTESTED] prefix so
//             the UI can flag low-trust resolutions.
// LOW       → force the verdict to UNRESOLVABLE so the contract refunds.
// Keeps the "refund the ambiguous" principle out of marketing slides and
// into actual on-chain behavior.
const CONFIDENCE_HIGH_MIN = 80; // ≥ : settle as-is
const CONFIDENCE_MED_MIN  = 60; // 60–79: settle but mark contested
                                // < 60 : downgrade to UNRESOLVABLE

function tierVerdict(verdict: OracleVerdict): OracleVerdict {
  if (verdict.verdict === "UNRESOLVABLE" || verdict.verdict === "DRAW") return verdict;
  if (verdict.confidence >= CONFIDENCE_HIGH_MIN) return verdict;
  if (verdict.confidence >= CONFIDENCE_MED_MIN) {
    return {
      ...verdict,
      explanation: `[CONTESTED] ${verdict.explanation}`.slice(0, 500),
    };
  }
  // Low confidence: refund rather than guess
  return {
    verdict:     "UNRESOLVABLE",
    confidence:  verdict.confidence,
    explanation: `[LOW CONFIDENCE — refunded] ${verdict.explanation}`.slice(0, 500),
  };
}

// Cap confidence and tag the audit trail when the evidence wasn't fetched
// through a deterministic API (CoinGecko). Scraped HTML — even via Jina —
// can drift, be paginated, or be partially blocked, so we don't allow a
// firm HIGH-tier settlement off it.
const MAX_CONFIDENCE_NON_API = 75;

function applyFetcherTrust(
  verdict: OracleVerdict,
  fetcher: EvidenceFetcherKind | "none",
): OracleVerdict {
  if (fetcher === "coingecko-api") return verdict;
  if (verdict.verdict === "UNRESOLVABLE") return verdict;
  const cappedConfidence = Math.min(verdict.confidence, MAX_CONFIDENCE_NON_API);
  const tag = fetcher === "jina" ? "[via-jina]" : fetcher === "direct" ? "[via-scrape]" : "[no-fetch]";
  return {
    ...verdict,
    confidence: cappedConfidence,
    explanation: `${tag} ${verdict.explanation}`.slice(0, 500),
  };
}

// ── ROLE 1: Settle expired claim ──────────────────────────────────────────────
async function settle(claim: ClaimOnChain): Promise<void> {
  console.log(`\n[settle] Claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);

  const evidence     = await fetchEvidence(claim);
  console.log(`[settle] Evidence fetcher: ${evidence.fetcher}`);
  if (evidence.payment) {
    const usdc = Number(evidence.payment.priceAtomic) / 1_000_000;
    console.log(`[settle] 💸 Paid ${usdc} ${evidence.payment.asset} for evidence (x402 nanopayment)`);
  }

  // Council-as-jury: buy each persona's verdict (x402 → persona wallet) and
  // settle by their tally. Commit the tally into the evidence hash so the
  // consensus is verifiable on-chain. Falls back to the solo oracle verdict.
  let rawVerdict: OracleVerdict;
  let commit = evidence.text;
  if (COUNCIL_SETTLEMENT) {
    const council = await gatherCouncilVerdict({
      claimId:       claim.id,
      category:      claim.category,
      baseUrl:       COUNCIL_BASE_URL,
      payer:         { walletId: ORACLE_WALLET, address: ORACLE_ADDR },
      capUsdc:       COUNCIL_VOTE_CAP,
      quorum:        COUNCIL_QUORUM,
    }).catch((err) => {
      console.warn(`[settle] council vote failed, falling back to solo:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (council) {
      const paidUsdc = Number(council.totalPaidAtomic) / 1_000_000;
      console.log(`[settle] 🏛️  Council ${council.tally.creator}–${council.tally.challengers} (${council.tally.draw + council.tally.unresolvable} abstain) · paid ${paidUsdc.toFixed(6)} USDC to jurors`);
      rawVerdict = { verdict: council.verdict, confidence: council.confidence, explanation: council.explanation };
      commit = `${evidence.text}\n[council]${JSON.stringify(council.tally)}`;
    } else {
      console.log(`[settle] Council below quorum — settling solo.`);
      rawVerdict = await evaluateClaim(claim, evidence.text);
    }
  } else {
    rawVerdict = await evaluateClaim(claim, evidence.text);
  }

  const evidenceHash = hashEvidence(commit);
  const trusted      = applyFetcherTrust(rawVerdict, evidence.fetcher);
  const verdict      = tierVerdict(trusted);

  const tierTag =
    verdict.verdict !== rawVerdict.verdict ? "REFUND" :
    verdict.explanation !== rawVerdict.explanation ? "CONTESTED" :
    "FIRM";

  console.log(`[settle] Verdict: ${verdict.verdict} (${verdict.confidence}%) [${tierTag}]`);
  console.log(`[settle] Evidence hash: ${evidenceHash}`);
  console.log(`[settle] "${verdict.explanation.slice(0, 100)}..."`);

  const txHash = await executeContract({
    walletId:             ORACLE_WALLET,
    contractAddress:      CONTRACT_ADDRESS,
    abiFunctionSignature: SIG_RESOLVE_CLAIM,
    abiParameters: toCircleAbiParameters([
      BigInt(claim.id),
      verdictToSide(verdict.verdict),
      verdict.explanation,
      verdict.confidence,
      evidenceHash,
    ]),
    refId: `settle-${claim.id}`,
  });

  console.log(`[settle] ✓ Resolved — ${getExplorerTxUrl(txHash)}`);
}

// ── ROLE 2: Challenge mispriced open claim ────────────────────────────────────
async function challengeIfMispriced(claim: ClaimOnChain): Promise<void> {
  if (!AUTO_CHALLENGE) return;

  const oracleAddress = ORACLE_ADDR.toLowerCase();

  // Skip: already challenged, already evaluated, private, oracle created it
  if (challengedClaimIds.has(claim.id)) return;
  if (evaluatedClaimIds.has(claim.id)) return;
  if (claim.isPrivate) return;
  if (claim.creator.toLowerCase() === oracleAddress) return;

  // Skip: oracle already challenged this claim
  const alreadyIn = await publicClient.readContract({
    address: CONTRACT_ADDRESS, abi: MIMIR_ABI,
    functionName: "hasChallenged",
    args: [BigInt(claim.id), ORACLE_ADDR],
  }) as boolean;
  if (alreadyIn) { evaluatedClaimIds.add(claim.id); return; }

  // Skip: claim is full
  if (claim.challengerCount >= claim.maxChallengers) {
    evaluatedClaimIds.add(claim.id);
    return;
  }

  // Check oracle USDC balance (native on Arc)
  const balance = await publicClient.getBalance({ address: ORACLE_ADDR });
  const stakeNeeded = usdcToMicro(CHALLENGE_STAKE_USDC);
  const buffer      = usdcToMicro(CHALLENGE_STAKE_USDC * 3); // keep 3x buffer for gas
  if (balance < stakeNeeded + buffer) {
    console.log(`[challenge] Insufficient balance (${microToUsdc(balance).toFixed(2)} USDC), skipping`);
    return;
  }

  // Evaluate early
  console.log(`\n[challenge] Evaluating claim #${claim.id}: "${claim.question.slice(0, 60)}..."`);
  evaluatedClaimIds.add(claim.id);

  const evidence = await fetchEvidence(claim);

  // Short-circuit: with no real evidence the LLM will return UNRESOLVABLE,
  // which never satisfies the CHALLENGERS_WIN/≥80% bar below. Skip the
  // wasted LLM call — saves a Gemini RPM slot per dead-evidence claim.
  if (evidence.fetcher === "none") {
    console.log(`[challenge] Skipping LLM — no evidence available (fetcher=none)`);
    return;
  }

  const rawVerdict = await evaluateClaim(claim, evidence.text);
  const verdict = applyFetcherTrust(rawVerdict, evidence.fetcher);

  console.log(`[challenge] Early verdict: ${verdict.verdict} (${verdict.confidence}%) [fetcher=${evidence.fetcher}]`);

  // Only challenge if highly confident challengers will win
  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < CHALLENGE_CONFIDENCE) {
    console.log(`[challenge] Not confident enough to stake — skipping`);
    return;
  }

  // Kelly Criterion: size position based on confidence edge
  // Assume pool odds ≈ 1.0 (even) for conservative sizing
  const kelly = kellyFraction(verdict.confidence);
  const bankroll = Number(balance) / 1e18; // USDC
  const kellyStake = Math.max(CHALLENGE_STAKE_USDC, Math.min(bankroll * kelly, bankroll * 0.1));
  const stakeUsdc = Math.round(kellyStake * 100) / 100; // round to 2dp

  console.log(`[challenge] Kelly: ${(kelly * 100).toFixed(1)}% of bankroll → ${stakeUsdc} USDC stake`);

  // Auto-challenge — Arc uses native USDC, so we pass `amount` to attach value
  console.log(`[challenge] Staking ${stakeUsdc} USDC on challenger side...`);
  const stakeWei = usdcToMicro(stakeUsdc);

  const txHash = await executeContract({
    walletId:             ORACLE_WALLET,
    contractAddress:      CONTRACT_ADDRESS,
    abiFunctionSignature: SIG_CHALLENGE_CLAIM,
    abiParameters:        toCircleAbiParameters([BigInt(claim.id), stakeWei, ""]),
    amount:               formatEther(stakeWei), // Circle expects decimal USDC, not wei
    refId:                `challenge-${claim.id}`,
  });

  challengedClaimIds.add(claim.id);
  console.log(`[challenge] ✓ Staked ${stakeUsdc} USDC — ${getExplorerTxUrl(txHash)}`);
  console.log(`[challenge] Oracle: "${verdict.explanation.slice(0, 120)}"`);
}

// ── Main poll loop ────────────────────────────────────────────────────────────
async function poll(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  let total: bigint;
  try {
    total = await publicClient.readContract({
      address: CONTRACT_ADDRESS, abi: MIMIR_ABI,
      functionName: "claimCount",
    }) as bigint;
  } catch (err) {
    console.warn("[oracle] Failed to read claimCount:", err);
    return;
  }

  console.log(`\n[oracle] ── Poll at ${new Date().toISOString()} ── ${total} claims`);

  const settled: number[]   = [];
  const challenged: number[] = [];
  const expiredActive: ClaimOnChain[] = [];

  for (let id = 1; id <= Number(total); id++) {
    const claim = await fetchClaim(id);
    if (!claim) continue;
    if (claim.state === STATE.ACTIVE && claim.deadline <= now) {
      expiredActive.push(claim);
      continue;
    }

    try {
      // Role 1: Settle expired active claims
      if (claim.state === STATE.ACTIVE && claim.deadline <= now) {
        await settle(claim);
        settled.push(id);
      }

      // Role 2: Challenge mispriced claims while the challenge window is open.
      // Mimir.sol allows up to MAX_CHALLENGERS per claim, so ACTIVE claims are
      // still joinable — duplicate-stake check happens inside the helper.
      if (
        (claim.state === STATE.OPEN || claim.state === STATE.ACTIVE) &&
        claim.deadline > now
      ) {
        const before = challengedClaimIds.size;
        await challengeIfMispriced(claim);
        if (challengedClaimIds.size > before) challenged.push(id);
      }
    } catch (err) {
      console.error(`[oracle] Error on claim ${id}:`, err);
    }
  }

  expiredActive.sort((a, b) => Number(a.deadline - b.deadline));
  for (let i = 0; i < expiredActive.length; i++) {
    const claim = expiredActive[i];
    try {
      await settle(claim);
      settled.push(claim.id);
      if (i < expiredActive.length - 1 && SETTLEMENT_DELAY_MS > 0) {
        console.log(`[oracle] Cooling down ${(SETTLEMENT_DELAY_MS / 60000).toFixed(1)} min before next settlement...`);
        await new Promise((resolve) => setTimeout(resolve, SETTLEMENT_DELAY_MS));
      }
    } catch (err) {
      console.error(`[oracle] Error settling claim ${claim.id}:`, err);
    }
  }

  const summary = [
    settled.length    ? `Settled: [${settled.join(", ")}]`    : null,
    challenged.length ? `Challenged: [${challenged.join(", ")}]` : null,
  ].filter(Boolean).join(" | ");

  console.log(summary ? `[oracle] ${summary}` : "[oracle] Nothing to do this round.");
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const balance = await publicClient.getBalance({ address: ORACLE_ADDR });

  console.log("═══════════════════════════════════════════════");
  console.log("  Mimir Oracle Agent (Circle W3S signer)");
  console.log(`  Contract   : ${CONTRACT_ADDRESS}`);
  console.log(`  Oracle     : ${ORACLE_ADDR}`);
  console.log(`  Wallet ID  : ${ORACLE_WALLET}`);
  console.log(`  Balance    : ${microToUsdc(balance).toFixed(4)} USDC`);
  console.log(`  Network    : Arc Testnet (${arcTestnet.id})`);
  console.log(`  LLM        : ${activeLLMProvider()} / ${activeLLMModel()} · key=${activeLLMKeyFingerprint()}`);
  console.log(`  Throttle   : ${LLM_THROTTLE_MS > 0 ? `${LLM_THROTTLE_MS}ms (${(60_000 / LLM_THROTTLE_MS).toFixed(1)} RPM cap)` : "OFF"}`);
  console.log(`  Settle gap : ${SETTLEMENT_DELAY_MS / 1000}s`);
  console.log(`  Poll every : ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  Auto-challenge: ${AUTO_CHALLENGE ? `YES (≥${CHALLENGE_CONFIDENCE}% confidence, ${CHALLENGE_STAKE_USDC} USDC/claim)` : "OFF (set AUTO_CHALLENGE=1 to enable)"}`);
  console.log("═══════════════════════════════════════════════\n");

  const safePoll = async () => {
    try {
      await poll();
    } catch (err) {
      console.error("[oracle] Poll failed, will retry next interval:", err);
    }
  };

  await safePoll();
  setInterval(safePoll, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error("[oracle] Fatal:", err);
  process.exit(1);
});
