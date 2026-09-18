/**
 * Fee arithmetic, mirroring MimirV3.sol exactly.
 *
 * This is the off-chain twin of `_payWinner`: the UI quotes a split before you
 * stake, and an agent's dry run needs the same numbers the contract will
 * produce. Any divergence between the two is a bug in this file.
 *
 * All amounts are atomic integers. USDC is native on Arc and carries 18
 * decimals, unlike the 6 decimals it has as an ERC-20 elsewhere, so the unit is
 * declared here once rather than assumed at each call site.
 */

/** Atomic units per USDC on Arc. Native currency, 18 decimals. */
export const USDC_DECIMALS = 18;
export const ONE_USDC = 10n ** BigInt(USDC_DECIMALS);

export const BPS_DENOMINATOR = 10_000n;

/** No policy may take more than 10% of a winner's profit, in total. */
export const MAX_TOTAL_FEE_BPS = 1_000;

export interface FeePolicy {
  /** Charged on profit, paid to the platform recipient. */
  platformFeeBps: number;
  /** Charged on profit, paid to the owner of the agent that opened the position. */
  agentOwnerFeeBps: number;
  platformRecipient: string | null;
}

/** What the contract is deployed with until governance changes it. */
export const DEFAULT_FEE_POLICY: FeePolicy = {
  platformFeeBps: 50,
  agentOwnerFeeBps: 50,
  platformRecipient: null,
};

export class InvalidFeePolicyError extends Error {}

export function validateFeePolicy(policy: FeePolicy): void {
  const { platformFeeBps, agentOwnerFeeBps, platformRecipient } = policy;
  for (const [name, bps] of [
    ["platformFeeBps", platformFeeBps],
    ["agentOwnerFeeBps", agentOwnerFeeBps],
  ] as const) {
    if (!Number.isInteger(bps) || bps < 0) {
      throw new InvalidFeePolicyError(`${name} must be a non-negative integer`);
    }
  }
  if (platformFeeBps + agentOwnerFeeBps > MAX_TOTAL_FEE_BPS) {
    throw new InvalidFeePolicyError(
      `total fee ${platformFeeBps + agentOwnerFeeBps} bps exceeds the ${MAX_TOTAL_FEE_BPS} bps cap`,
    );
  }
  if (platformFeeBps > 0 && !platformRecipient) {
    throw new InvalidFeePolicyError("a platform fee needs a recipient");
  }
}

export interface FeeSplitInput {
  /** Everything the winner would receive before fees, atomic. */
  gross: bigint;
  /** What the winner staked, atomic. Fees never touch this. */
  principal: bigint;
  policy: FeePolicy;
  /** Who is being paid. Used to waive a leg they would pay to themselves. */
  winner: string;
  /** Owner of the agent this position ran through, if any. */
  agentOwner?: string | null;
}

export interface FeeSplit {
  profit: bigint;
  platformFee: bigint;
  agentOwnerFee: bigint;
  totalFees: bigint;
  /** What actually lands in the winner's wallet. */
  netPayout: bigint;
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/**
 * Split a gross payout into fees and net.
 *
 * The base is `gross - principal` floored at zero: a refund, a break-even win
 * and a cancelled market are all free. Division rounds down, so any remainder
 * stays with the participant instead of the protocol. A recipient who is also
 * the winner waives that leg rather than paying themselves.
 */
export function splitFees({ gross, principal, policy, winner, agentOwner }: FeeSplitInput): FeeSplit {
  validateFeePolicy(policy);
  const profit = gross > principal ? gross - principal : 0n;

  let platformFee = 0n;
  let agentOwnerFee = 0n;

  if (profit > 0n) {
    if (
      policy.platformFeeBps > 0 &&
      policy.platformRecipient &&
      !sameAddress(policy.platformRecipient, winner)
    ) {
      platformFee = (profit * BigInt(policy.platformFeeBps)) / BPS_DENOMINATOR;
    }
    if (policy.agentOwnerFeeBps > 0 && agentOwner && !sameAddress(agentOwner, winner)) {
      agentOwnerFee = (profit * BigInt(policy.agentOwnerFeeBps)) / BPS_DENOMINATOR;
    }
  }

  const totalFees = platformFee + agentOwnerFee;
  return { profit, platformFee, agentOwnerFee, totalFees, netPayout: gross - totalFees };
}

/**
 * The invariant that makes the whole schedule defensible: being right must
 * never cost money. Charging the gross payout breaks this — stake 10 into a
 * crowded side, win 11 back, and a gross fee can hand you back less than 10.
 */
export function noWinnerLosesPrincipal(split: FeeSplit, principal: bigint): boolean {
  return split.netPayout >= principal;
}

/** Nothing is created or destroyed: what the escrow pays out plus fees equals the gross. */
export function conservationHolds(split: FeeSplit, gross: bigint): boolean {
  return split.netPayout + split.totalFees === gross;
}

/** Human-readable atomic amount, for UI quotes. */
export function formatUsdc(atomic: bigint, maxDecimals = 6): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / ONE_USDC;
  const frac = (abs % ONE_USDC).toString().padStart(USDC_DECIMALS, "0").slice(0, maxDecimals);
  const trimmed = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}
