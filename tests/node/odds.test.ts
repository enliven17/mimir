import test from "node:test";
import assert from "node:assert/strict";

import {
  impliedOdds,
  formatProbability,
  oddsBarWidths,
  crowdImbalance,
} from "../../lib/odds";
import type { VSData } from "../../lib/contract";

function vs(over: Partial<VSData> = {}): VSData {
  return {
    id: 1,
    creator: "0x1",
    opponent: "0x2",
    question: "q",
    creator_position: "yes",
    opponent_position: "no",
    resolution_url: "https://example.com/x",
    stake_amount: 10,
    deadline: 0,
    state: "accepted",
    winner: "",
    resolution_summary: "",
    category: "crypto",
    creator_stake: 10,
    total_challenger_stake: 10,
    odds_mode: "pool",
    ...over,
  } as VSData;
}

test("an evenly funded pool prices both sides at 50%", () => {
  const odds = impliedOdds(vs());
  assert.equal(odds.creatorProbability, 0.5);
  assert.equal(odds.challengerProbability, 0.5);
  assert.equal(odds.totalPot, 20);
  assert.equal(odds.unpriced, false);
});

test("money piling onto a side raises that side's implied probability", () => {
  // Challengers hold 30 of a 40 pot: the crowd says challengers are likelier.
  const odds = impliedOdds(vs({ creator_stake: 10, total_challenger_stake: 30 }));
  assert.equal(odds.challengerProbability, 0.75);
  assert.equal(odds.creatorProbability, 0.25);
});

test("a crowded side pays less, and the payout matches the price", () => {
  const crowded = impliedOdds(vs({ creator_stake: 10, total_challenger_stake: 30 }));
  // Joining the crowded challenger side: your stake back plus a small share.
  assert.ok(crowded.challengerPayoutMultiple! < 1.5);

  const thin = impliedOdds(vs({ creator_stake: 30, total_challenger_stake: 10 }));
  // Joining the thin side: your stake back plus all of a much bigger pot.
  assert.equal(thin.challengerPayoutMultiple, 4);
  assert.equal(thin.challengerProbability, 0.25);
});

test("an unchallenged claim has no price yet", () => {
  const odds = impliedOdds(vs({ total_challenger_stake: 0 }));
  assert.equal(odds.unpriced, true);
  assert.equal(odds.creatorProbability, null);
  assert.equal(odds.challengerProbability, null);
  assert.equal(odds.challengerPayoutMultiple, null);
});

test("missing or junk stake fields do not produce NaN odds", () => {
  for (const over of [
    { creator_stake: undefined, stake_amount: 5, total_challenger_stake: 5 },
    { creator_stake: -1, total_challenger_stake: 5 },
    { total_challenger_stake: Number.NaN },
  ] as Array<Partial<VSData>>) {
    const odds = impliedOdds(vs(over));
    for (const value of [odds.creatorProbability, odds.challengerProbability]) {
      assert.ok(value === null || Number.isFinite(value), JSON.stringify(over));
    }
  }
});

test("fixed odds are a quoted price, available before anyone joins", () => {
  const odds = impliedOdds(
    vs({ odds_mode: "fixed", challenger_payout_bps: 20_000, total_challenger_stake: 0 }),
  );
  assert.equal(odds.mode, "fixed");
  assert.equal(odds.unpriced, false, "a quote exists without a counterparty");
  assert.equal(odds.challengerPayoutMultiple, 2);
  assert.equal(odds.challengerProbability, 0.5);

  const longShot = impliedOdds(vs({ odds_mode: "fixed", challenger_payout_bps: 40_000 }));
  assert.equal(longShot.challengerPayoutMultiple, 4);
  assert.equal(longShot.challengerProbability, 0.25);
});

test("fixed odds fall back to the contract default when unset", () => {
  const odds = impliedOdds(vs({ odds_mode: "fixed", challenger_payout_bps: 0 }));
  assert.equal(odds.challengerPayoutMultiple, 2);
});

test("probabilities always complement each other", () => {
  for (const [c, ch] of [[10, 30], [1, 99], [7, 3], [10, 10]]) {
    const odds = impliedOdds(vs({ creator_stake: c, total_challenger_stake: ch }));
    assert.ok(Math.abs(odds.creatorProbability! + odds.challengerProbability! - 1) < 1e-9);
  }
});

test("a null probability renders as a dash rather than zero", () => {
  assert.equal(formatProbability(null), "—");
  assert.equal(formatProbability(Number.NaN), "—");
  assert.equal(formatProbability(0.5), "50%");
  assert.equal(formatProbability(0.004), "0%");
  assert.equal(formatProbability(1), "100%");
});

test("bar widths always sum to 100 and keep a funded side visible", () => {
  for (const [c, ch] of [[1, 999], [999, 1], [10, 10], [3, 7]]) {
    const widths = oddsBarWidths(impliedOdds(vs({ creator_stake: c, total_challenger_stake: ch })));
    assert.equal(widths.creator + widths.challenger, 100, `${c}/${ch}`);
    assert.ok(widths.creator >= 4 && widths.challenger >= 4, `${c}/${ch} collapsed a side`);
  }
});

test("an unpriced claim fills the bar with the creator side", () => {
  const widths = oddsBarWidths(impliedOdds(vs({ total_challenger_stake: 0 })));
  assert.deepEqual(widths, { creator: 100, challenger: 0 });
});

test("imbalance runs from 0 at even money to 1 at one-sided", () => {
  assert.equal(crowdImbalance(impliedOdds(vs({ creator_stake: 10, total_challenger_stake: 10 }))), 0);
  const lopsided = crowdImbalance(impliedOdds(vs({ creator_stake: 1, total_challenger_stake: 99 })));
  assert.ok(lopsided > 0.9 && lopsided <= 1);
  assert.equal(crowdImbalance(impliedOdds(vs({ total_challenger_stake: 0 }))), 0);
});
