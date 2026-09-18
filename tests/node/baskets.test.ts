import test from "node:test";
import assert from "node:assert/strict";

import {
  validateBasket,
  simulateVirtualBasket,
  followMessage,
  worstCaseFollowerExposure,
  InvalidBasketError,
  DEFAULT_BASKET_POLICY,
  VIRTUAL_BASKET_INITIAL_NAV,
  WEIGHT_TOTAL_BPS,
  type BasketMember,
  type MemberSettlement,
} from "../../lib/baskets";
import { ONE_USDC } from "../../lib/fees";

const members: BasketMember[] = [
  { agentId: "alpha", weightBps: 5_000 },
  { agentId: "beta", weightBps: 5_000 },
];

const ok = { name: "Contrarian mix", thesis: "Fade crowded consensus.", members };

function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof InvalidBasketError);
    return (err as InvalidBasketError).reason;
  }
  return "no_error";
}

test("a well-formed basket validates", () => {
  assert.doesNotThrow(() => validateBasket(ok));
});

test("weights must total exactly 10000 bps", () => {
  // Both legs stay under the concentration cap, so the total is what fails.
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "beta", weightBps: 4_999 },
    ] })),
    "weights_must_total_10000_bps",
  );
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 4_000 },
      { agentId: "beta", weightBps: 4_000 },
    ] })),
    "weights_must_total_10000_bps",
  );
});

test("an agent cannot appear twice", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "alpha", weightBps: 5_000 },
    ] })),
    "duplicate_agent",
  );
});

test("weights must be positive integers", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 5_000 },
      { agentId: "beta", weightBps: 0 },
    ] })),
    "non_positive_weight",
  );
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 4_000.5 },
      { agentId: "beta", weightBps: 4_999.5 },
    ] })),
    "weight_not_integer",
  );
});

test("no single agent may exceed the concentration cap", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [
      { agentId: "alpha", weightBps: 6_000 },
      { agentId: "beta", weightBps: 4_000 },
    ] })),
    "single_agent_over_cap",
  );
  // Exactly at the cap is allowed.
  assert.doesNotThrow(() => validateBasket(ok));
  assert.equal(members[0].weightBps, DEFAULT_BASKET_POLICY.maxSingleAgentBps);
});

test("a basket cannot be one agent, or a crowd", () => {
  assert.equal(
    reasonOf(() => validateBasket({ ...ok, members: [{ agentId: "alpha", weightBps: 10_000 }] })),
    "too_few_members",
  );
  const many = Array.from({ length: 13 }, (_, i) => ({ agentId: `a${i}`, weightBps: 769 }));
  assert.equal(reasonOf(() => validateBasket({ ...ok, members: many })), "too_many_members");
});

test("name and thesis are required", () => {
  assert.equal(reasonOf(() => validateBasket({ ...ok, name: "   " })), "missing_name");
  assert.equal(reasonOf(() => validateBasket({ ...ok, thesis: "" })), "missing_thesis");
});

test("an empty history leaves the NAV untouched", () => {
  const perf = simulateVirtualBasket(members, []);
  assert.equal(perf.points.length, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
  assert.equal(perf.totalReturn, 0);
  assert.deepEqual(perf.idleAgents.sort(), ["alpha", "beta"]);
});

test("returns are stake-weighted, not vote-weighted", () => {
  // alpha wins 1 on a 10 stake (+10%), beta loses 1 on a 1 stake (-100%).
  // Equal weights: 0.5 * 0.10 + 0.5 * -1.00 = -45%.
  const settlements: MemberSettlement[] = [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 10n * ONE_USDC, pnlAtomic: ONE_USDC },
    { agentId: "beta", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
  ];
  const perf = simulateVirtualBasket(members, settlements);
  assert.equal(perf.points.length, 1);
  assert.ok(Math.abs(perf.points[0].dailyReturn + 0.45) < 1e-9);
  assert.equal(perf.finalNavAtomic, 550n * ONE_USDC);
});

test("a member's several settlements in a day aggregate before weighting", () => {
  const settlements: MemberSettlement[] = [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 5n * ONE_USDC, pnlAtomic: ONE_USDC },
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 5n * ONE_USDC, pnlAtomic: -ONE_USDC },
  ];
  const perf = simulateVirtualBasket(members, settlements);
  // alpha nets 0 over a 10 stake; beta idle. The day is flat, not +10% then -10%.
  assert.equal(perf.points[0].dailyReturn, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
});

test("an idle leg earns zero rather than the basket average", () => {
  // alpha doubles its money, beta does nothing: half the weight at 0%.
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC },
  ]);
  assert.ok(Math.abs(perf.points[0].dailyReturn - 0.5) < 1e-9);
  assert.deepEqual(perf.idleAgents, ["beta"]);
});

test("a day nobody settled produces no point at all", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC / 10n },
    { agentId: "alpha", day: "2026-09-03", stakeAtomic: ONE_USDC, pnlAtomic: ONE_USDC / 10n },
  ]);
  assert.deepEqual(perf.points.map((p) => p.day), ["2026-09-01", "2026-09-03"]);
});

test("settlements from agents outside the basket are ignored", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "stranger", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: 100n * ONE_USDC },
  ]);
  assert.equal(perf.points.length, 0);
  assert.equal(perf.finalNavAtomic, VIRTUAL_BASKET_INITIAL_NAV);
});

test("drawdown is measured against the running high, not the start", () => {
  const perf = simulateVirtualBasket(members, [
    // Day 1: +20% basket (alpha +40% on its half).
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: 10n * ONE_USDC, pnlAtomic: 4n * ONE_USDC },
    // Day 2: -10% basket.
    { agentId: "alpha", day: "2026-09-02", stakeAtomic: 10n * ONE_USDC, pnlAtomic: -2n * ONE_USDC },
  ]);
  assert.ok(Math.abs(perf.points[0].dailyReturn - 0.2) < 1e-9);
  assert.equal(perf.points[0].drawdown, 0, "a new high has no drawdown");
  assert.ok(Math.abs(perf.points[1].drawdown + 0.1) < 1e-9, "down 10% from the high, not up 8% from the start");
  assert.ok(perf.totalReturn > 0, "still ahead of where it started");
  assert.ok(perf.maxDrawdown < 0);
});

test("the NAV cannot go negative", () => {
  const perf = simulateVirtualBasket(members, [
    { agentId: "alpha", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
    { agentId: "beta", day: "2026-09-01", stakeAtomic: ONE_USDC, pnlAtomic: -ONE_USDC },
  ]);
  assert.equal(perf.finalNavAtomic, 0n);
  assert.ok(perf.finalNavAtomic >= 0n);
});

test("the follow message names the basket, the follower and the cap", () => {
  const message = followMessage({
    basketId: "contrarian-mix",
    follower: "0xAbC0000000000000000000000000000000000001",
    perMarketCapUsdc: 5,
  });
  assert.match(message, /basket: contrarian-mix/);
  assert.match(message, /follower: 0xabc0000000000000000000000000000000000001/);
  assert.match(message, /perMarketCapUsdc: 5/);
  assert.match(message, /Nothing is deposited/);
});

test("worst-case follower exposure is the cap across every member", () => {
  assert.equal(worstCaseFollowerExposure(members, 5), 10);
  assert.equal(worstCaseFollowerExposure(members, 0), 0, "unfollowing caps exposure at zero");
});

test("the weight total constant matches what validation enforces", () => {
  assert.equal(members.reduce((a, m) => a + m.weightBps, 0), WEIGHT_TOTAL_BPS);
});
