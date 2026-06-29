/**
 * Shared types for the Mimir Council runtime.
 */

import type { PublicClient } from "viem";
import type { PersonaSpec } from "../personas";

/**
 * On-chain claim shape consumed by the runner. Mirrors the relevant subset
 * of getClaim + getClaimMarketConfig outputs.
 */
export interface ClaimOnChain {
  id:                   number;
  creator:              string;
  question:             string;
  creatorPosition:      string;
  counterPosition:      string;
  resolutionUrl:        string;
  creatorStake:         bigint;
  totalChallengerStake: bigint;
  deadline:             bigint;
  state:                number;
  category:             string;
  marketType:           string;
  challengerCount:      bigint;
  maxChallengers:       bigint;
  isPrivate:            boolean;
  settlementRule:       string;
}

/**
 * What a persona decides about a single claim in a single cycle.
 *
 * Personas can only join the challenger side (createClaim is the
 * market-creator's role). When a persona's analysis agrees with the
 * creator's position, the persona simply abstains.
 */
export interface PersonaDecision {
  shouldStake:   boolean;
  /** USDC amount staked. Only meaningful when shouldStake is true. */
  stakeUsdc:     number;
  /** Human-readable reason — surfaced in the activity log and /council. */
  rationale:     string;
  /** Optional LLM confidence (0-100) for callers that want to display it. */
  confidence?:   number;
  /** Reason for skipping when shouldStake is false. For observability. */
  skipReason?:
    | "category-filter"
    | "abstain-low-confidence"
    | "abstain-agrees-with-creator"
    | "already-challenged"
    | "self-created"
    | "private"
    | "full"
    | "insufficient-balance"
    | "no-pool-imbalance"
    | "no-whale-yet"
    | "no-evidence"
    | "llm-failed";
}

export interface PersonaRunnerContext {
  publicClient:     PublicClient;
  contractAddress:  `0x${string}`;
  evidenceCache:    Map<number, EvidenceCacheEntry>;
  peerReasoning?:   Map<string, string[]>;
}

export interface EvidenceCacheEntry {
  text:    string;
  fetcher: string;
  hash:    `0x${string}`;
}

export interface PersonaStakeReceipt {
  persona:   PersonaSpec;
  claimId:   number;
  stakeUsdc: number;
  txHash:    string;
  rationale: string;
}
