/**
 * Rule-based persona evaluators — no LLM call.
 *
 * The Contrarian and Whale-Watcher don't think; they just react to the
 * existing pool state. This keeps two personas free of LLM rate-limit
 * pressure and produces deterministic, easy-to-explain bets.
 *
 * Both rules return CHALLENGER (stake) or ABSTAIN. They never recommend
 * the creator side because personas can't join the creator pool.
 */

import { weiToUsdc } from "../../../lib/arc";
import { MIMIR_ABI } from "../../../lib/mimir-abi";
import type { PublicClient } from "viem";
import type { PersonaSpec } from "../personas";
import type { ClaimOnChain, PersonaDecision } from "./types";

/**
 * Contrarian: stake against whichever side currently holds the larger pool.
 *
 * Since personas can only join the challenger pool, the rule reduces to:
 *   - creator pool > challenger pool → challenge (the crowd is "wrong")
 *   - creator pool ≤ challenger pool → abstain (would join the larger side)
 *
 * Adds a small fairness margin so we don't twitch on tiny imbalances.
 */
export function evaluateContrarian(
  persona: PersonaSpec,
  claim: ClaimOnChain,
): PersonaDecision {
  const stakeUsdc = persona.stakeUsdc ?? 2;
  const creator   = claim.creatorStake;
  const challenger = claim.totalChallengerStake;

  // Avoid acting when no one has staked the challenger side yet — that's
  // the market-creator's baseline pool, not "crowd sentiment".
  if (challenger === 0n) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Contrarian abstains: no challenger pool yet to bet against.",
      skipReason:  "no-pool-imbalance",
    };
  }

  // Need a real imbalance — at least 20% one way.
  const total = creator + challenger;
  const creatorShare = total > 0n ? Number((creator * 100n) / total) : 50;

  if (creatorShare >= 60) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Contrarian: creator holds ${creatorShare}% of the pool. The crowd is leaning hard one way — I take the other side.`,
    };
  }

  return {
    shouldStake: false,
    stakeUsdc:   0,
    rationale: `Contrarian abstains: pool is balanced (creator ${creatorShare}%) — nothing to react against.`,
    skipReason:  "no-pool-imbalance",
  };
}

/**
 * Whale-Watcher: copy the side staked by the single largest individual.
 *
 * - Reads getChallengerList to see individual challenger stakes.
 * - Compares the largest challenger against the creator's stake.
 * - If a challenger is the biggest, the whale is on the challenger side →
 *   the Whale-Watcher also stakes challenger.
 * - If the creator is the biggest, the whale is on creator side → abstain
 *   (the persona can't join creator).
 */
export async function evaluateWhaleWatcher(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
): Promise<PersonaDecision> {
  const stakeUsdc = persona.stakeUsdc ?? 2;

  if (claim.totalChallengerStake === 0n) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Whale-Watcher waits: no challenger has staked yet, no whale to follow.",
      skipReason:  "no-whale-yet",
    };
  }

  let stakes: readonly bigint[] = [];
  try {
    const result = await publicClient.readContract({
      address: contractAddress,
      abi: MIMIR_ABI,
      functionName: "getChallengerList",
      args: [BigInt(claim.id)],
    }) as readonly [readonly `0x${string}`[], readonly bigint[]];
    stakes = result[1];
  } catch {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Whale-Watcher: failed to read challenger list, abstaining this round.",
      skipReason:  "no-whale-yet",
    };
  }

  if (stakes.length === 0) {
    return {
      shouldStake: false,
      stakeUsdc:   0,
      rationale:   "Whale-Watcher waits: challenger list is empty.",
      skipReason:  "no-whale-yet",
    };
  }

  const biggestChallenger = stakes.reduce((m, s) => (s > m ? s : m), 0n);

  if (biggestChallenger > claim.creatorStake) {
    return {
      shouldStake: true,
      stakeUsdc,
      rationale: `Whale-Watcher: largest individual stake is on the challenger side (${weiToUsdc(biggestChallenger).toFixed(2)} USDC vs creator's ${weiToUsdc(claim.creatorStake).toFixed(2)}). I follow the whale.`,
    };
  }

  return {
    shouldStake: false,
    stakeUsdc:   0,
    rationale: `Whale-Watcher abstains: the biggest single staker is the creator (${weiToUsdc(claim.creatorStake).toFixed(2)} USDC). I can't join the creator side, so I sit out.`,
    skipReason:  "abstain-agrees-with-creator",
  };
}
