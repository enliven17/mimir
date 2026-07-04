import assert from "node:assert/strict";
import test from "node:test";

import {
  Q_PRIOR,
  BONUS_DUST_USDC,
  verdictToProbability,
  crossEntropyScore,
  scoreCouncilVotes,
  allocateBonus,
  type CouncilVote,
} from "../../agents/oracle/council-vote";

// ── verdictToProbability ──────────────────────────────────────────────────────

test("confidence maps symmetrically around the prior", () => {
  assert.equal(verdictToProbability("CHALLENGERS_WIN", 80, Q_PRIOR), 0.9);
  assert.equal(verdictToProbability("CREATOR_WINS", 80, Q_PRIOR), 0.1);
  assert.equal(verdictToProbability("CHALLENGERS_WIN", 0, Q_PRIOR), 0.5);
});

test("q is clamped away from 0 and 1 so log scores stay finite", () => {
  assert.equal(verdictToProbability("CHALLENGERS_WIN", 100, Q_PRIOR), 0.98);
  assert.equal(verdictToProbability("CREATOR_WINS", 100, Q_PRIOR), 0.02);
  assert.equal(verdictToProbability("CHALLENGERS_WIN", 250, Q_PRIOR), 0.98);
});

test("DRAW and UNRESOLVABLE carry no information — q stays at qPrev", () => {
  assert.equal(verdictToProbability("DRAW", 90, 0.7), 0.7);
  assert.equal(verdictToProbability("UNRESOLVABLE", 90, 0.3), 0.3);
});

// ── crossEntropyScore ─────────────────────────────────────────────────────────

test("no update scores exactly zero — parroting the prior pays nothing", () => {
  assert.equal(crossEntropyScore(0.9, 0.5, 0.5), 0);
});

test("updates toward the reference score positive, away score negative", () => {
  assert.ok(crossEntropyScore(0.9, 0.8, 0.5) > 0);
  assert.ok(crossEntropyScore(0.9, 0.2, 0.5) < 0);
  // Mirror case: reference favors the creator.
  assert.ok(crossEntropyScore(0.1, 0.2, 0.5) > 0);
  assert.ok(crossEntropyScore(0.1, 0.8, 0.5) < 0);
});

test("reporting the reference belief itself maximizes the score", () => {
  const qT = 0.85;
  const atReference = crossEntropyScore(qT, qT, 0.5);
  for (const q of [0.55, 0.65, 0.75, 0.95]) {
    assert.ok(atReference > crossEntropyScore(qT, q, 0.5));
  }
});

test("scores are additive along the chain (market scoring rule telescopes)", () => {
  // Two sequential jurors moving 0.5→0.7→0.9 together earn what one juror
  // moving 0.5→0.9 would — payment splits by marginal contribution.
  const qT = 0.9;
  const combined = crossEntropyScore(qT, 0.7, 0.5) + crossEntropyScore(qT, 0.9, 0.7);
  const direct = crossEntropyScore(qT, 0.9, 0.5);
  assert.ok(Math.abs(combined - direct) < 1e-12);
});

// ── scoreCouncilVotes ─────────────────────────────────────────────────────────

function makeVote(overrides: Partial<CouncilVote>): CouncilVote {
  return {
    slug: "optimist",
    displayName: "The Optimist",
    verdict: "CHALLENGERS_WIN",
    confidence: 80,
    pricePaidAtomic: null,
    ...overrides,
  };
}

test("scoreCouncilVotes chains q from the prior and skips abstainers", () => {
  const votes = [
    makeVote({ slug: "a", probability: 0.8 }),
    makeVote({ slug: "b", probability: undefined }), // abstained — no q
    makeVote({ slug: "c", probability: 0.9 }),
  ];
  const scored = scoreCouncilVotes(votes, 0.9);
  assert.ok(scored[0].score! > 0);              // 0.5 → 0.8 toward reference
  assert.equal(scored[1].score, 0);             // abstainer scores zero
  assert.ok(scored[2].score! > 0);              // 0.8 → 0.9, chain skipped b
  const direct = crossEntropyScore(0.9, 0.9, 0.8);
  assert.ok(Math.abs(scored[2].score! - direct) < 1e-12);
});

// ── allocateBonus ─────────────────────────────────────────────────────────────

test("bonus splits proportionally across positive scores only", () => {
  const bonuses = allocateBonus([0.3, 0.1, -0.5, 0], 0.008);
  assert.equal(bonuses[0], 0.006);
  assert.equal(bonuses[1], 0.002);
  assert.equal(bonuses[2], 0);
  assert.equal(bonuses[3], 0);
});

test("total payout never exceeds the pool", () => {
  const bonuses = allocateBonus([1.7, 0.9, 0.4], 0.01);
  const total = bonuses.reduce((a, b) => a + b, 0);
  assert.ok(total <= 0.01 + 1e-9);
});

test("dust shares are skipped, all-negative rounds pay nothing", () => {
  // 1% of the pool is below the dust floor.
  const bonuses = allocateBonus([99, 1], 0.01);
  assert.ok(bonuses[0] > 0);
  assert.equal(bonuses[1], 0);
  assert.ok((0.01 * 1) / 100 < BONUS_DUST_USDC);
  assert.deepEqual(allocateBonus([-1, -2, 0], 0.01), [0, 0, 0]);
});
