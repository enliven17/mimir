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

import { getExplorerTxUrl } from "../../../lib/arc";
import { claimKey, usdcToStakeUnits, type ChainKey } from "../../../lib/chains";
import { w3sEscrowWrite } from "../../../lib/w3s-escrow";
import { MIMIR_ABI } from "../../../lib/mimir-abi";
import { kellyFraction } from "../../../lib/kelly";
import { createThrottle } from "../../../lib/agent-bootstrap";
import { stakeBalanceUsdc } from "../../shared/chains";
import { type PersonaSpec, personaWalletIdEnv } from "../personas";
import { getOrFetchEvidence } from "./evidence-cache";
import { personaAddressOf, personaWalletIdOn } from "./wallets";
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

const DEFAULT_MIN_CONFIDENCE = 75;
const DEFAULT_STAKE_USDC     = 2;

/**
 * Gemini free tier is 15 req/min. We chain LLM calls serially inside a
 * single process and add a small delay between them so a burst across
 * 8+ personas doesn't trip 429s. Overridable via COUNCIL_LLM_THROTTLE_MS.
 */
const LLM_THROTTLE_MS = Number(process.env.COUNCIL_LLM_THROTTLE_MS ?? 8000);
const throttleLlm = createThrottle(LLM_THROTTLE_MS);

// Conservative Kelly cap: personas play across many markets (oracle uses 0.25).
const KELLY_CAP = 0.15;

/** Key into PersonaRunnerContext.peerReasoning. Chain-scoped: ids collide across chains. */
export function peerReasoningKey(chain: ChainKey, claimId: number, personaSlug: string): string {
  return `${claimKey(chain, claimId)}:${personaSlug}`;
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
  const evidence = await getOrFetchEvidence(claimKey(ctx.chain, claim.id), claim.resolutionUrl, ctx.evidenceCache);
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
    verdict = await evaluateClaimAsPersona(
      persona,
      claim,
      evidence.text,
      ctx.peerReasoning?.get(peerReasoningKey(ctx.chain, claim.id, persona.slug)) ?? [],
    );
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
  const tag = `[council:${persona.slug}][${ctx.chain}]`;
  const walletId = personaWalletIdOn(persona, ctx.chain);
  const addressRaw = personaAddressOf(persona);
  if (!walletId || !addressRaw) {
    console.warn(
      `${tag} missing wallet env (${personaWalletIdEnv(persona)} on ${ctx.chain}) — run "npm run council:create-wallets" first.`,
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

  // Stakeable USDC on this chain (native on Arc, ERC-20 elsewhere) — keep a
  // 2x stake buffer so we never drain.
  const bankrollUsdc = await stakeBalanceUsdc(ctx.chain, address);
  const baseStakeUsdc = persona.stakeUsdc ?? DEFAULT_STAKE_USDC;
  if (bankrollUsdc < baseStakeUsdc * 2) {
    console.log(
      `${tag} insufficient balance (${bankrollUsdc.toFixed(2)} USDC), skipping`,
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
    const kelly = kellyFraction(decision.confidence, KELLY_CAP);
    const kellyStake = Math.max(
      baseStakeUsdc,
      Math.min(bankrollUsdc * kelly, bankrollUsdc * 0.10),
    );
    stakeUsdc = Math.round(kellyStake * 100) / 100;
  }

  // Submit. msg.value on Arc, exact ERC-20 approve + pull elsewhere.
  const txHash = await w3sEscrowWrite({
    chain:        ctx.chain,
    walletId,
    owner:        address,
    functionName: "challengeClaim",
    args:         [BigInt(claim.id), usdcToStakeUnits(ctx.chain, stakeUsdc), ""],
    stakeUsdc,
    refId:        `council-${persona.slug}-${ctx.chain}-${claim.id}`,
  });

  console.log(
    `${tag} ✓ Staked ${stakeUsdc} USDC on claim #${claim.id} — ${getExplorerTxUrl(txHash, ctx.chain)}`,
  );
  console.log(`${tag}   ${decision.rationale.slice(0, 160)}`);

  return {
    persona,
    chain:     ctx.chain,
    claimId:   claim.id,
    stakeUsdc,
    txHash,
    rationale: decision.rationale,
  };
}
