/**
 * Per-persona evaluation + staking pipeline.
 *
 * Given a persona, a claim, and shared cycle context, this:
 *   1. Runs cheap skip checks (already-challenged, self-created, private, full).
 *   2. Branches on archetype:
 *        - rule-based → contrarian / whale-follow evaluators (no LLM)
 *        - llm-biased / specialist / micro → persona-LLM with cached evidence
 *   3. Decides whether to stake and how much (Kelly for LLM personas).
 *   4. Submits challengeClaim through the persona's W3S wallet.
 */

import { formatEther } from "viem";
import {
  microToUsdc,
  usdcToMicro,
  getExplorerTxUrl,
} from "../../../lib/arc";
import {
  executeContract,
  buildAbiFunctionSignature,
  toCircleAbiParameters,
} from "../../../lib/circle-w3s";
import { MIMIR_ABI } from "../../../lib/mimir-abi";
import {
  type PersonaSpec,
  personaWalletIdEnv,
  personaAddressEnv,
} from "../personas";
import { getOrFetchEvidence } from "./evidence-cache";
import { evaluateClaimAsPersona, type PersonaVerdict } from "./persona-llm";
import {
  evaluateContrarian,
  evaluateWhaleWatcher,
} from "./persona-rules";
import type {
  ClaimOnChain,
  PersonaDecision,
  PersonaRunnerContext,
  PersonaStakeReceipt,
} from "./types";

const SIG_CHALLENGE_CLAIM = buildAbiFunctionSignature("challengeClaim", MIMIR_ABI);

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_STAKE_USDC     = 2;

/**
 * Gemini free tier is 15 req/min. We chain LLM calls serially inside a
 * single process and add a small delay between them so a burst across
 * 8+ personas doesn't trip 429s. Overridable via COUNCIL_LLM_THROTTLE_MS.
 */
const LLM_THROTTLE_MS = Number(process.env.COUNCIL_LLM_THROTTLE_MS ?? 8000);
let lastLlmCallAt = 0;

async function throttleLlm(): Promise<void> {
  const now = Date.now();
  const since = now - lastLlmCallAt;
  if (since < LLM_THROTTLE_MS) {
    await new Promise((r) => setTimeout(r, LLM_THROTTLE_MS - since));
  }
  lastLlmCallAt = Date.now();
}

/**
 * Kelly Criterion fraction of bankroll for a given confidence,
 * conservative cap at 15% of bankroll per bet (lower than oracle's
 * 25% because personas play across many markets).
 */
function kellyFraction(confidencePct: number, netOdds = 1.0): number {
  const p = confidencePct / 100;
  const q = 1 - p;
  const f = (p * netOdds - q) / netOdds;
  return Math.max(0, Math.min(0.15, f));
}

function categoryMatches(persona: PersonaSpec, claim: ClaimOnChain): boolean {
  if (!persona.categoryFilter || persona.categoryFilter.length === 0) {
    return true;
  }
  const c = (claim.category ?? "").toLowerCase();
  return persona.categoryFilter.some((tag) => c.includes(tag.toLowerCase()));
}

/**
 * Pure decision step — no on-chain writes. Useful for the CouncilVoteWidget
 * which wants to surface a persona's verdict without actually staking.
 */
export async function evaluatePersonaForClaim(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  ctx: PersonaRunnerContext,
): Promise<PersonaDecision & { verdict?: PersonaVerdict }> {
  // Specialists only consider claims in their category.
  if (!categoryMatches(persona, claim)) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName} only watches ${persona.categoryFilter?.join(" / ")} markets — this one is out of scope.`,
      skipReason:  "category-filter",
    };
  }

  // Rule-based personas: no LLM call.
  if (persona.archetype === "rule-based") {
    if (persona.ruleEvaluator === "contrarian") {
      return evaluateContrarian(persona, claim);
    }
    if (persona.ruleEvaluator === "whale-follow") {
      return evaluateWhaleWatcher(persona, claim, ctx.publicClient, ctx.contractAddress);
    }
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName} has no rule evaluator wired.`,
      skipReason:  "abstain-low-confidence",
    };
  }

  // LLM-based path (llm-biased, specialist, micro).
  const evidence = await getOrFetchEvidence(claim.id, claim.resolutionUrl, ctx.evidenceCache);
  if (evidence.fetcher === "none") {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName}: no usable evidence at the resolution URL — abstaining.`,
      skipReason:  "no-evidence",
    };
  }

  let verdict: PersonaVerdict;
  try {
    await throttleLlm();
    verdict = await evaluateClaimAsPersona(persona, claim, evidence.text);
  } catch (err) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName}: LLM call failed (${err instanceof Error ? err.message : "unknown"}).`,
      skipReason:  "llm-failed",
    };
  }

  const minConf = persona.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  if (verdict.verdict === "CREATOR_WINS") {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName} agrees with the creator (${verdict.confidence}%): ${verdict.explanation}`,
      confidence:  verdict.confidence,
      skipReason:  "abstain-agrees-with-creator",
      verdict,
    };
  }

  if (verdict.verdict !== "CHALLENGERS_WIN" || verdict.confidence < minConf) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   `${persona.displayName} won't stake: verdict ${verdict.verdict} at ${verdict.confidence}% (threshold ${minConf}%). ${verdict.explanation}`,
      confidence:  verdict.confidence,
      skipReason:  "abstain-low-confidence",
      verdict,
    };
  }

  // Confident enough to stake. Size with Kelly, capped at 10% of bankroll.
  // Note: the bankroll cap is enforced inside runPersonaForClaim where the
  // wallet balance is read. Here we surface the base stake from the spec.
  return {
    shouldStake: true,
    stakeUsdc:   persona.stakeUsdc ?? DEFAULT_STAKE_USDC,
    rationale:   `${persona.displayName} stakes: ${verdict.explanation}`,
    confidence:  verdict.confidence,
    verdict,
  };
}

/**
 * Full pipeline — runs decision + on-chain stake if all guards pass.
 * Returns a receipt when a stake is submitted, null otherwise.
 */
export async function runPersonaForClaim(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  ctx: PersonaRunnerContext,
): Promise<PersonaStakeReceipt | null> {
  const walletId = process.env[personaWalletIdEnv(persona)];
  const addressRaw = process.env[personaAddressEnv(persona)];
  if (!walletId || !addressRaw) {
    console.warn(
      `[council:${persona.slug}] missing wallet env — run "npm run council:create-wallets" first.`,
    );
    return null;
  }
  const address = addressRaw.toLowerCase() as `0x${string}`;

  // Cheap skip checks — same shape the oracle uses, scoped to this persona.
  if (claim.isPrivate) return null;
  if (claim.creator.toLowerCase() === address) return null;
  if (claim.challengerCount >= claim.maxChallengers) return null;

  // hasChallenged is an idempotent on-chain guard — skip if we're already in.
  let alreadyIn = false;
  try {
    alreadyIn = await ctx.publicClient.readContract({
      address: ctx.contractAddress,
      abi: MIMIR_ABI,
      functionName: "hasChallenged",
      args: [BigInt(claim.id), address as `0x${string}`],
    }) as boolean;
  } catch {
    // If the read fails, default to skipping rather than risking double-stake.
    return null;
  }
  if (alreadyIn) return null;

  // Wallet balance — keep a 2x stake buffer so we never drain.
  const balance = await ctx.publicClient.getBalance({ address: address as `0x${string}` });
  const baseStakeUsdc = persona.stakeUsdc ?? DEFAULT_STAKE_USDC;
  const minRequired = usdcToMicro(baseStakeUsdc * 2);
  if (balance < minRequired) {
    console.log(
      `[council:${persona.slug}] insufficient balance (${microToUsdc(balance).toFixed(2)} USDC), skipping`,
    );
    return null;
  }

  // Decide.
  const decision = await evaluatePersonaForClaim(persona, claim, ctx);
  if (!decision.shouldStake) {
    return null;
  }

  // For LLM personas, apply Kelly sizing on top of the base stake.
  // Rule personas don't have a confidence score — they use the base stake as-is.
  let stakeUsdc = decision.stakeUsdc;
  if (decision.confidence && decision.confidence >= (persona.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) {
    const kelly = kellyFraction(decision.confidence);
    const bankrollUsdc = Number(balance) / 1e18;
    const kellyStake = Math.max(
      baseStakeUsdc,
      Math.min(bankrollUsdc * kelly, bankrollUsdc * 0.10),
    );
    stakeUsdc = Math.round(kellyStake * 100) / 100;
  }

  // Submit.
  const stakeWei = usdcToMicro(stakeUsdc);
  const txHash = await executeContract({
    walletId,
    contractAddress:      ctx.contractAddress,
    abiFunctionSignature: SIG_CHALLENGE_CLAIM,
    abiParameters:        toCircleAbiParameters([BigInt(claim.id), stakeWei, ""]),
    amount:               formatEther(stakeWei),
    refId:                `council-${persona.slug}-${claim.id}`,
  });

  console.log(
    `[council:${persona.slug}] ✓ Staked ${stakeUsdc} USDC on claim #${claim.id} — ${getExplorerTxUrl(txHash)}`,
  );
  console.log(`[council:${persona.slug}]   ${decision.rationale.slice(0, 160)}`);

  return {
    persona,
    claimId:   claim.id,
    stakeUsdc,
    txHash,
    rationale: decision.rationale,
  };
}
