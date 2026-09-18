import assert from "node:assert/strict";
import test from "node:test";

import { computeClaimQuality, type ClaimQualityInput } from "../../lib/claimQuality";

const NOW_TS = 1_800_000_000;

const STRONG: ClaimQualityInput = {
  question: "Will BTC close above $100,000 on 2026-05-25 according to CoinGecko?",
  creator_position: "BTC closes above $100,000",
  opponent_position: "BTC closes at or below $100,000",
  resolution_url: "https://www.coingecko.com/en/coins/bitcoin",
  settlement_rule:
    "Resolve from the linked source page, reading the closing price at the deadline timestamp in UTC.",
  category: "crypto",
  deadline: NOW_TS + 48 * 60 * 60,
};

const passed = (input: ClaimQualityInput, key: string) =>
  computeClaimQuality(input, NOW_TS).signals.find((s) => s.key === key)?.passed;

test("a well-formed claim scores strong", () => {
  const result = computeClaimQuality(STRONG, NOW_TS);
  assert.equal(result.score, 100);
  assert.equal(result.tier, "strong");
});

test("a vague question scores weak even when every field is filled in", () => {
  // The old scorer graded length and presence, so this passed as strong.
  const result = computeClaimQuality(
    {
      question: "Will it rain?",
      creator_position: "Yes",
      opponent_position: "No",
      resolution_url: "https://weather.example.com/forecast",
      settlement_rule:
        "Resolve this from the linked source page as of the deadline, reading whatever it says.",
      category: "weather",
      deadline: NOW_TS + 48 * 60 * 60,
    },
    NOW_TS,
  );
  assert.equal(result.tier, "weak");
  assert.ok(result.score < 40, `scored ${result.score}`);
});

test("scores are bounded and tiers line up with them", () => {
  const empty = computeClaimQuality(
    {
      question: "",
      creator_position: "",
      opponent_position: "",
      resolution_url: "",
      settlement_rule: "",
      category: "custom",
      deadline: 0,
    },
    NOW_TS,
  );
  assert.equal(empty.score, 0);
  assert.equal(empty.tier, "weak");
  assert.equal(computeClaimQuality(STRONG, NOW_TS).score, 100);
});

test("a question needs two independent decidability signals", () => {
  // A number alone is not enough.
  assert.equal(passed({ ...STRONG, question: "Will 2026 be a year for Bitcoin holders?" }, "question_decidable"), false);
  // A verb alone is not enough.
  assert.equal(passed({ ...STRONG, question: "Will the company announce a new thing?" }, "question_decidable"), false);
  // A threshold plus a comparison is.
  assert.equal(passed({ ...STRONG, question: "Will ETH trade above $4,000 before 2026-12-01?" }, "question_decidable"), true);
});

test("subjective wording fails, in the question or the rule", () => {
  assert.equal(passed({ ...STRONG, question: "Will BTC make a significant move above $100,000 by 2026-05-25?" }, "objective_language"), false);
  assert.equal(
    passed(
      { ...STRONG, settlement_rule: "Resolve from the linked source at the deadline if the move was substantial." },
      "objective_language",
    ),
    false,
  );
  assert.equal(passed(STRONG, "objective_language"), true);
});

test("a subjective term inside a longer word does not trip the check", () => {
  // "goodwill" contains "good"; the check is word-bounded.
  assert.equal(
    passed({ ...STRONG, question: "Will goodwill impairment exceed $100,000,000 before 2026-05-25?" }, "objective_language"),
    true,
  );
});

test("compound questions fail", () => {
  assert.equal(
    passed({ ...STRONG, question: "Will BTC close above $100,000 and will ETH close above $4,000 by 2026-05-25?" }, "single_outcome"),
    false,
  );
  assert.equal(
    passed({ ...STRONG, question: "Will BTC close above $100,000? Will ETH?" }, "single_outcome"),
    false,
  );
  assert.equal(passed(STRONG, "single_outcome"), true);
});

test("a name containing 'and' is not treated as compound", () => {
  assert.equal(
    passed({ ...STRONG, question: "Will Standard and Poor's 500 close above 6,000 before 2026-05-25?" }, "single_outcome"),
    true,
  );
});

test("sources that cannot settle anything are refused", () => {
  for (const url of [
    "",
    "not a url",
    "https://x.com/someone/status/1",
    "https://twitter.com/someone",
    "https://www.reddit.com/r/bitcoin",
    "https://youtube.com/watch?v=abc",
    "https://coingecko.com", // bare homepage
    "https://coingecko.com/", // still bare
  ]) {
    assert.equal(passed({ ...STRONG, resolution_url: url }, "source_present"), false, url);
  }
  for (const url of [
    "https://www.coingecko.com/en/coins/bitcoin",
    "https://api.example.com/v1/price?symbol=btc",
    "coingecko.com/en/coins/bitcoin",
  ]) {
    assert.equal(passed({ ...STRONG, resolution_url: url }, "source_present"), true, url);
  }
});

test("a settlement rule must name both the source and the timing", () => {
  assert.equal(passed({ ...STRONG, settlement_rule: "Resolve it fairly." }, "settlement_specific"), false);
  assert.equal(
    passed({ ...STRONG, settlement_rule: "Read the linked source page and decide from what it says." }, "settlement_specific"),
    false,
    "no timing",
  );
  assert.equal(
    passed({ ...STRONG, settlement_rule: "Check the value exactly at the deadline timestamp in UTC and settle on it." }, "settlement_specific"),
    false,
    "no source",
  );
  assert.equal(passed(STRONG, "settlement_specific"), true);
});

test("the time window is bounded at both ends", () => {
  assert.equal(passed({ ...STRONG, deadline: NOW_TS + 60 }, "sufficient_time"), false, "too soon");
  assert.equal(passed({ ...STRONG, deadline: NOW_TS + 6 * 3600 }, "sufficient_time"), true, "exactly at the floor");
  assert.equal(passed({ ...STRONG, deadline: NOW_TS + 400 * 24 * 3600 }, "sufficient_time"), false, "too far out");
  assert.equal(passed({ ...STRONG, deadline: NOW_TS - 3600 }, "sufficient_time"), false, "already past");
});

test("a question must be a question, and not an essay", () => {
  assert.equal(passed({ ...STRONG, question: "BTC above 100000 on 2026-05-25 per CoinGecko" }, "question_specific"), false);
  assert.equal(passed({ ...STRONG, question: `${"Will BTC close above $100,000? ".repeat(20)}` }, "question_specific"), false);
  assert.equal(passed(STRONG, "question_specific"), true);
});

test("identical positions fail", () => {
  assert.equal(
    passed({ ...STRONG, creator_position: "Yes", opponent_position: " yes " }, "positions_clear"),
    false,
  );
});
