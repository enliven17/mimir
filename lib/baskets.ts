/**
 * Agent baskets: a weighted mix of agents with a stated thesis.
 *
 * A basket holds nothing. Following one is **mirroring, never depositing**: a
 * follower signs a message naming the basket and a per-market USDC cap, and
 * every copied position is staked from their own wallet with their own
 * signature. Nothing is pooled, so there is no vault to drain and no custody to
 * misplace.
 *
 * The published curve is a projection of what member agents actually settled on
 * chain, not a claim about money anyone deposited.
 */

import { ONE_USDC } from "./fees";

export const WEIGHT_TOTAL_BPS = 10_000;

/** The notional a virtual basket is replayed with: 1,000 USDC. */
export const VIRTUAL_BASKET_INITIAL_NAV = 1_000n * ONE_USDC;

export interface BasketMember {
  /** A registered agent id, or a council persona slug. */
  agentId: string;
  weightBps: number;
}

export interface BasketPolicy {
  /** No single agent may carry more than this share of a basket. */
  maxSingleAgentBps: number;
  /** Minimum distinct members, so a "basket" is not one agent with extra steps. */
  minMembers: number;
  maxMembers: number;
}

export const DEFAULT_BASKET_POLICY: BasketPolicy = {
  maxSingleAgentBps: 5_000,
  minMembers: 2,
  maxMembers: 12,
};

export interface BasketDefinition {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  members: BasketMember[];
  createdAt: number;
}

export type BasketRejectionReason =
  | "weights_must_total_10000_bps"
  | "duplicate_agent"
  | "non_positive_weight"
  | "weight_not_integer"
  | "single_agent_over_cap"
  | "too_few_members"
  | "too_many_members"
  | "missing_name"
  | "missing_thesis";

export class InvalidBasketError extends Error {
  constructor(
    readonly reason: BasketRejectionReason,
    message: string,
  ) {
    super(message);
    this.name = "InvalidBasketError";
  }
}

/**
 * Validate a basket before it is stored.
 *
 * Checks run in a fixed order and the first failure wins, so the same
 * definition always produces the same refusal.
 */
export function validateBasket(
  input: { name: string; thesis: string; members: BasketMember[] },
  policy: BasketPolicy = DEFAULT_BASKET_POLICY,
): void {
  const { name, thesis, members } = input;

  if (!name.trim()) throw new InvalidBasketError("missing_name", "a basket needs a name");
  if (!thesis.trim()) {
    throw new InvalidBasketError("missing_thesis", "a basket needs a stated thesis");
  }
  if (members.length < policy.minMembers) {
    throw new InvalidBasketError(
      "too_few_members",
      `a basket needs at least ${policy.minMembers} agents`,
    );
  }
  if (members.length > policy.maxMembers) {
    throw new InvalidBasketError(
      "too_many_members",
      `a basket may hold at most ${policy.maxMembers} agents`,
    );
  }

  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.agentId)) {
      throw new InvalidBasketError("duplicate_agent", `${m.agentId} appears twice`);
    }
    seen.add(m.agentId);

    if (!Number.isInteger(m.weightBps)) {
      throw new InvalidBasketError("weight_not_integer", `${m.agentId} has a fractional weight`);
    }
    if (m.weightBps <= 0) {
      throw new InvalidBasketError("non_positive_weight", `${m.agentId} has a zero or negative weight`);
    }
    if (m.weightBps > policy.maxSingleAgentBps) {
      throw new InvalidBasketError(
        "single_agent_over_cap",
        `${m.agentId} is above the ${policy.maxSingleAgentBps} bps single-agent cap`,
      );
    }
  }

  const total = members.reduce((acc, m) => acc + m.weightBps, 0);
  if (total !== WEIGHT_TOTAL_BPS) {
    throw new InvalidBasketError(
      "weights_must_total_10000_bps",
      `weights total ${total} bps, they must total ${WEIGHT_TOTAL_BPS}`,
    );
  }
}

// ── Virtual NAV ─────────────────────────────────────────────────────────────

export interface MemberSettlement {
  agentId: string;
  /** Calendar day of the settlement, YYYY-MM-DD. */
  day: string;
  /** What the agent had staked in that market, atomic. */
  stakeAtomic: bigint;
  /** Realized profit or loss, atomic. Negative when the agent lost. */
  pnlAtomic: bigint;
}

export interface NavPoint {
  day: string;
  navAtomic: bigint;
  /** Basket return for that day, as a fraction (0.012 = +1.2%). */
  dailyReturn: number;
  /** Drawdown against the running high, as a non-positive fraction. */
  drawdown: number;
}

export interface BasketPerformance {
  points: NavPoint[];
  finalNavAtomic: bigint;
  totalReturn: number;
  maxDrawdown: number;
  /** Members that never settled anything in the window. */
  idleAgents: string[];
}

/**
 * Replay a hypothetical allocation through what the members actually settled.
 *
 * Three decisions worth stating:
 *
 *  - **Stake-weighted, not vote-weighted.** A 10 USDC decision and a 1 USDC
 *    decision are not two equal opinions, so a member's daily return is its
 *    total PnL over its total stake that day.
 *  - **A day with no settlements produces no point.** An idle agent draws a
 *    flat line rather than a zero that drags the average toward nothing.
 *  - **An idle leg earns zero, not the basket average.** A member that did not
 *    trade that day contributes its weight at 0%, which is what sitting in USDC
 *    actually pays.
 */
export function simulateVirtualBasket(
  members: BasketMember[],
  settlements: MemberSettlement[],
  initialNav: bigint = VIRTUAL_BASKET_INITIAL_NAV,
): BasketPerformance {
  const weights = new Map(members.map((m) => [m.agentId, m.weightBps]));

  // Only members of this basket count, and only their settled markets.
  const relevant = settlements.filter((s) => weights.has(s.agentId));

  const byDay = new Map<string, Map<string, { stake: bigint; pnl: bigint }>>();
  for (const s of relevant) {
    const day = byDay.get(s.day) ?? new Map();
    const agg = day.get(s.agentId) ?? { stake: 0n, pnl: 0n };
    agg.stake += s.stakeAtomic;
    agg.pnl += s.pnlAtomic;
    day.set(s.agentId, agg);
    byDay.set(s.day, day);
  }

  const days = [...byDay.keys()].sort();
  const points: NavPoint[] = [];

  let nav = initialNav;
  let runningHigh = initialNav;
  let maxDrawdown = 0;

  for (const day of days) {
    const perAgent = byDay.get(day)!;
    let dailyReturn = 0;
    for (const [agentId, { stake, pnl }] of perAgent) {
      if (stake === 0n) continue;
      const weight = (weights.get(agentId) ?? 0) / WEIGHT_TOTAL_BPS;
      // Ratios are small and bounded, so float here is fine; the NAV itself
      // stays an integer.
      const memberReturn = Number(pnl) / Number(stake);
      dailyReturn += weight * memberReturn;
    }

    nav = nav + BigInt(Math.trunc(Number(nav) * dailyReturn));
    if (nav < 0n) nav = 0n;
    if (nav > runningHigh) runningHigh = nav;

    // Guarded so a new high reports 0 rather than -0, which reads as a loss.
    const drawdown =
      runningHigh === 0n || nav >= runningHigh
        ? 0
        : -(Number(runningHigh - nav) / Number(runningHigh));
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;

    points.push({ day, navAtomic: nav, dailyReturn, drawdown });
  }

  const active = new Set(relevant.map((s) => s.agentId));
  const idleAgents = members.map((m) => m.agentId).filter((id) => !active.has(id));

  return {
    points,
    finalNavAtomic: nav,
    totalReturn: initialNav === 0n ? 0 : Number(nav - initialNav) / Number(initialNav),
    maxDrawdown,
    idleAgents,
  };
}

// ── Following ───────────────────────────────────────────────────────────────

/**
 * The message a composer signs when publishing a basket.
 *
 * Creating a basket moves nothing, but it still carries the composer's name, so
 * it is signed: otherwise anyone could publish a thesis under someone else's
 * wallet. The weights are spelled out so the prompt shows what is being claimed.
 */
export function composeMessage(id: string, name: string, members: BasketMember[]): string {
  return [
    "Mimir basket",
    `id: ${id}`,
    `name: ${name}`,
    ...members.map((m) => `  ${m.agentId}: ${m.weightBps} bps`),
  ].join("\n");
}

/**
 * The message a follower signs. It names the basket, the follower and the cap,
 * so what is approved is legible in the wallet prompt rather than encoded.
 * Unfollowing is the same signature with the cap set to zero.
 *
 * `signedAt` (ms) makes every signature single-use in practice: the server
 * only accepts one inside a short window and newer than the last one it
 * stored, so an old "cap 50" cannot be replayed after an unfollow.
 */
export function followMessage(args: {
  basketId: string;
  follower: string;
  perMarketCapUsdc: number;
  signedAt: number;
}): string {
  return [
    "Mimir basket subscription",
    `basket: ${args.basketId}`,
    `follower: ${args.follower.toLowerCase()}`,
    `perMarketCapUsdc: ${args.perMarketCapUsdc}`,
    `signedAt: ${args.signedAt}`,
    "Positions are staked from your own wallet with your own signature.",
    "Nothing is deposited and nothing is pooled.",
  ].join("\n");
}

/** Worst case a follower can be on the hook for across a basket's members. */
export function worstCaseFollowerExposure(members: BasketMember[], perMarketCapUsdc: number): number {
  return members.length * perMarketCapUsdc;
}
