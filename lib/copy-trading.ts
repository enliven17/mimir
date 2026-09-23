/**
 * Copy trading: mirroring one agent's positions inside a policy signed up front.
 *
 * The permission is the product. A follower decides, once and in advance, which
 * agent they will copy, how much per position, how much per day and week, how
 * much they are willing to lose before it stops, and when the whole thing
 * expires. Everything after that is a deterministic gate: given the same
 * permission, signal and usage, it always returns the same answer, and the skip
 * reason names exactly which bound was hit.
 *
 * Determinism is the point. A copy engine that "usually" declines is one nobody
 * can reason about after the fact, and this is somebody's money.
 */

import { claimKey, type ChainKey } from "./chains";

export const COPY_SKIP_REASONS = [
  "globally_paused",
  "permission_inactive",
  "permission_expired",
  "self_copy",
  "depth_exceeded",
  "cycle_detected",
  "duplicate_position",
  "stale_signal",
  "category_not_allowed",
  "mode_not_allowed",
  "quality_below_floor",
  "payout_below_floor",
  "position_cap",
  "daily_cap",
  "weekly_cap",
  "exposure_cap",
  "realized_loss_limit",
] as const;

export type CopySkipReason = (typeof COPY_SKIP_REASONS)[number];

export interface CopyPermission {
  id: string;
  /** Wallet whose USDC is staked when a copy executes. */
  follower: string;
  /** The agent being copied. */
  signalAgentId: string;
  /** The agent that will place the follower's position. */
  executionAgentId: string;
  active: boolean;
  /** ms epoch. A permission always expires; there is no perpetual grant. */
  expiresAt: number;
  maxPerPositionUsdc: number;
  maxDailyUsdc: number;
  maxWeeklyUsdc: number;
  /** Total USDC allowed to sit in open copied positions at once. */
  maxOpenExposureUsdc: number;
  /** Copying stops for good once realized losses reach this. */
  maxRealizedLossUsdc: number;
  /** Empty means every category is allowed. */
  allowedCategories: string[];
  /** Empty means every settlement mode is allowed. */
  allowedModes: string[];
  /**
   * Floor on the claim's quality score, 0 to 100.
   *
   * Named for what it actually measures. At copy time the signal agent has not
   * published a confidence anywhere readable, so the only honest signal about
   * the position is how decidable the claim itself is (`lib/claimQuality.ts`).
   * Calling that "confidence" in a message somebody signs would be a claim the
   * data does not support.
   */
  minClaimQuality: number;
  minPayoutRatio: number;
  signature: string;
  createdAt: number;
}

export interface CopySignal {
  signalAgentId: string;
  claimId: number;
  /** Chain the claim lives on. Absent means Arc. */
  chain?: ChainKey;
  category: string;
  /** "pool" or "fixed". */
  oddsMode: string;
  stakeUsdc: number;
  /** The claim's quality score, 0 to 100. */
  claimQuality: number;
  /** Gross payout per unit staked, e.g. 1.8 means 1.8x. */
  payoutRatio: number;
  /** ms epoch of the signal position. */
  placedAt: number;
  /** The chain of agents this signal was already copied through. */
  ancestry?: string[];
}

export interface CopyUsage {
  spentTodayUsdc: number;
  spentThisWeekUsdc: number;
  openExposureUsdc: number;
  realizedLossUsdc: number;
  /** Claims the follower already holds, as claimKey(chain, id): ids repeat across chains. */
  heldClaimIds: string[];
}

export interface CopyDecision {
  allowed: boolean;
  reason?: CopySkipReason;
  message?: string;
  /** What would actually be staked. Never more than the signal or the cap. */
  stakeUsdc: number;
}

/** A copy of a copy is refused: depth 1 only. */
export const MAX_COPY_DEPTH = 1;

/** A signal older than this is stale; the odds it was taken at have moved. */
export const MAX_SIGNAL_AGE_MS = 15 * 60 * 1000;

export class InvalidCopyPermissionError extends Error {}

export function validateCopyPermission(p: CopyPermission, now = Date.now()): void {
  if (!p.follower || !p.signalAgentId || !p.executionAgentId) {
    throw new InvalidCopyPermissionError("follower, signal agent and execution agent are required");
  }
  if (p.signalAgentId === p.executionAgentId) {
    throw new InvalidCopyPermissionError("an agent cannot be both the signal and the executor");
  }
  if (!(p.expiresAt > now)) {
    throw new InvalidCopyPermissionError("a permission must expire in the future");
  }
  for (const [name, value] of [
    ["maxPerPositionUsdc", p.maxPerPositionUsdc],
    ["maxDailyUsdc", p.maxDailyUsdc],
    ["maxWeeklyUsdc", p.maxWeeklyUsdc],
    ["maxOpenExposureUsdc", p.maxOpenExposureUsdc],
    ["maxRealizedLossUsdc", p.maxRealizedLossUsdc],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new InvalidCopyPermissionError(`${name} must be a positive number`);
    }
  }
  if (p.maxPerPositionUsdc > p.maxDailyUsdc) {
    throw new InvalidCopyPermissionError("a single position cannot exceed the daily cap");
  }
  if (p.maxDailyUsdc > p.maxWeeklyUsdc) {
    throw new InvalidCopyPermissionError("the daily cap cannot exceed the weekly cap");
  }
  if (p.minClaimQuality < 0 || p.minClaimQuality > 100) {
    throw new InvalidCopyPermissionError("minClaimQuality must be between 0 and 100");
  }
  if (p.minPayoutRatio < 1) {
    throw new InvalidCopyPermissionError("minPayoutRatio below 1 would accept a guaranteed loss");
  }
}

function deny(reason: CopySkipReason, message: string): CopyDecision {
  return { allowed: false, reason, message, stakeUsdc: 0 };
}

/**
 * Decide whether one signal may be copied, and for how much.
 *
 * Checks run in a fixed order and the first failure wins. The order goes from
 * "this should not be running at all" to "this specific number is too big", so
 * the reason a caller sees is the most fundamental one that applies rather than
 * whichever check happened to run first.
 */
export function evaluateCopy(args: {
  permission: CopyPermission;
  signal: CopySignal;
  usage: CopyUsage;
  now?: number;
  globallyPaused?: boolean;
}): CopyDecision {
  const { permission: p, signal: s, usage: u, now = Date.now(), globallyPaused = false } = args;

  if (globallyPaused) return deny("globally_paused", "copy execution is paused");
  if (!p.active) return deny("permission_inactive", "this permission is not active");
  if (p.expiresAt <= now) return deny("permission_expired", "this permission has expired");

  if (p.executionAgentId === s.signalAgentId) {
    return deny("self_copy", "an agent cannot copy itself");
  }

  const ancestry = s.ancestry ?? [];
  if (ancestry.length > MAX_COPY_DEPTH - 1) {
    return deny("depth_exceeded", "a copy of a copy is not executed");
  }
  if (ancestry.includes(p.executionAgentId)) {
    return deny("cycle_detected", "this signal already passed through the executing agent");
  }

  if (u.heldClaimIds.includes(claimKey(s.chain ?? "arc", s.claimId))) {
    return deny("duplicate_position", `already holding a position in claim ${s.claimId}`);
  }

  if (now - s.placedAt > MAX_SIGNAL_AGE_MS) {
    return deny("stale_signal", "the signal is too old for its odds to still hold");
  }

  if (p.allowedCategories.length > 0 && !p.allowedCategories.includes(s.category)) {
    return deny("category_not_allowed", `${s.category} is not in the allowed categories`);
  }
  if (p.allowedModes.length > 0 && !p.allowedModes.includes(s.oddsMode)) {
    return deny("mode_not_allowed", `${s.oddsMode} odds are not allowed`);
  }

  if (s.claimQuality < p.minClaimQuality) {
    return deny("quality_below_floor", `claim quality ${s.claimQuality} is below ${p.minClaimQuality}`);
  }
  if (s.payoutRatio < p.minPayoutRatio) {
    return deny("payout_below_floor", `payout ${s.payoutRatio}x is below ${p.minPayoutRatio}x`);
  }

  if (u.realizedLossUsdc >= p.maxRealizedLossUsdc) {
    return deny("realized_loss_limit", "the realized-loss ceiling has been reached");
  }

  // Size down to the smallest binding cap rather than refusing outright: a
  // follower who set a 2 USDC ceiling wants a 2 USDC copy of a 50 USDC signal,
  // not no copy at all.
  let stake = Math.min(s.stakeUsdc, p.maxPerPositionUsdc);
  stake = Math.min(stake, p.maxDailyUsdc - u.spentTodayUsdc);
  stake = Math.min(stake, p.maxWeeklyUsdc - u.spentThisWeekUsdc);
  stake = Math.min(stake, p.maxOpenExposureUsdc - u.openExposureUsdc);

  if (u.spentTodayUsdc >= p.maxDailyUsdc) {
    return deny("daily_cap", "the daily cap is already spent");
  }
  if (u.spentThisWeekUsdc >= p.maxWeeklyUsdc) {
    return deny("weekly_cap", "the weekly cap is already spent");
  }
  if (u.openExposureUsdc >= p.maxOpenExposureUsdc) {
    return deny("exposure_cap", "open exposure is already at the ceiling");
  }
  if (stake <= 0) {
    return deny("position_cap", "no room left under the caps for a position");
  }

  // Round to cents: the contract takes 18-decimal amounts, but a copy sized to
  // a float artefact is noise nobody asked for.
  return { allowed: true, stakeUsdc: Math.floor(stake * 100) / 100 };
}

/** The most a permission can cost its follower before anything else stops it. */
export function worstCaseCopySpend(p: CopyPermission): number {
  return Math.min(p.maxWeeklyUsdc, p.maxOpenExposureUsdc + p.maxRealizedLossUsdc);
}

/**
 * The message a follower signs to grant a copy permission. Every bound appears
 * in the text: what is approved should be readable in the wallet prompt, not
 * encoded into a hash the signer has to trust.
 */
export function copyPermissionMessage(p: Omit<CopyPermission, "signature" | "createdAt">): string {
  return [
    "Mimir copy permission",
    `id: ${p.id}`,
    `follower: ${p.follower.toLowerCase()}`,
    `copy: ${p.signalAgentId}`,
    `executed by: ${p.executionAgentId}`,
    `per position: ${p.maxPerPositionUsdc} USDC`,
    `per day: ${p.maxDailyUsdc} USDC`,
    `per week: ${p.maxWeeklyUsdc} USDC`,
    `open exposure: ${p.maxOpenExposureUsdc} USDC`,
    `stop after losing: ${p.maxRealizedLossUsdc} USDC`,
    `min claim quality: ${p.minClaimQuality}/100`,
    `min payout: ${p.minPayoutRatio}x`,
    `categories: ${p.allowedCategories.length > 0 ? p.allowedCategories.join(", ") : "any"}`,
    `modes: ${p.allowedModes.length > 0 ? p.allowedModes.join(", ") : "any"}`,
    `expires: ${new Date(p.expiresAt).toISOString()}`,
    "Positions are staked from your own wallet. Nothing is deposited and nothing is pooled.",
  ].join("\n");
}
