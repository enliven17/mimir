import assert from "node:assert/strict";
import test from "node:test";

import { computeClaimQuality } from "../../lib/claimQuality";

const NOW_TS = 1_800_000_000;

test("minimal claim quality scores as weak", () => {
  const result = computeClaimQuality(
    {
      question: "Will it rain?",
      creator_position: "Yes",
      opponent_position: "No",
      resolution_url: "",
      settlement_rule: "",
      category: "custom",
      deadline: NOW_TS + 60,
    },
    NOW_TS
  );

  assert.equal(result.score, 15);
  assert.equal(result.tier, "weak");
});

test("well-formed claim quality scores as strong", () => {
  const result = computeClaimQuality(
    {
      question: "Will BTC close above $100k before next Friday at 23:59 UTC?",
      creator_position: "BTC closes above $100k",
      opponent_position: "BTC stays at or below $100k",
      resolution_url: "https://coingecko.com/en/coins/bitcoin",
      settlement_rule:
        "Resolve this using the linked source price exactly at the deadline timestamp.",
      category: "crypto",
      deadline: NOW_TS + 48 * 60 * 60,
    },
    NOW_TS
  );

  assert.equal(result.score, 100);
  assert.equal(result.tier, "strong");
});

test("identical positions lose the positions_clear signal", () => {
  const result = computeClaimQuality(
    {
      question: "Will Argentina beat Brazil in regulation time this Saturday?",
      creator_position: "Argentina wins",
      opponent_position: "Argentina wins",
      resolution_url: "https://bbc.com/sport/football/scores-fixtures",
      settlement_rule: "Use the official final result listed on the linked source.",
      category: "deportes",
      deadline: NOW_TS + 24 * 60 * 60,
    },
    NOW_TS
  );

  assert.equal(
    result.signals.find((signal) => signal.key === "positions_clear")?.passed,
    false
  );
  assert.equal(result.score, 85);
});

test("custom category loses the structured category points", () => {
  const result = computeClaimQuality(
    {
      question: "Will this custom event happen before the end of the month?",
      creator_position: "It happens",
      opponent_position: "It does not happen",
      resolution_url: "https://example.com/result",
      settlement_rule: "Resolve only using the linked source and the exact wording above.",
      category: "custom",
      deadline: NOW_TS + 24 * 60 * 60,
    },
    NOW_TS
  );

  assert.equal(
    result.signals.find((signal) => signal.key === "structured_category")?.passed,
    false
  );
  assert.equal(result.score, 90);
});

test("near deadlines lose the sufficient time signal", () => {
  const result = computeClaimQuality(
    {
      question: "Will ETH trade above $7k in the next three hours?",
      creator_position: "ETH trades above $7k",
      opponent_position: "ETH stays below $7k",
      resolution_url: "https://coingecko.com/en/coins/ethereum",
      settlement_rule: "Resolve against the linked source exactly at the deadline.",
      category: "crypto",
      deadline: NOW_TS + 3 * 60 * 60,
    },
    NOW_TS
  );

  assert.equal(
    result.signals.find((signal) => signal.key === "sufficient_time")?.passed,
    false
  );
  assert.equal(result.score, 90);
});
