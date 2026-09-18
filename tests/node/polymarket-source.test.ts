import test from "node:test";
import assert from "node:assert/strict";

import {
  toCandidate,
  rankCandidates,
  formatPolymarketPrompt,
  isPolymarketEnabled,
  MAX_PROBABILITY,
  MIN_PROBABILITY,
  MIN_LIQUIDITY_USD,
  MIN_HOURS_TO_END,
  MAX_HOURS_TO_END,
  type PolymarketCandidate,
} from "../../agents/market-creator/polymarket";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const hoursOut = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

/** Shaped like a real Gamma row: outcomes and prices arrive JSON-encoded. */
function raw(over: Record<string, unknown> = {}) {
  return {
    question: "Will the Fed cut rates at the December 2026 meeting?",
    slug: "fed-cut-december-2026",
    endDate: hoursOut(30 * 24),
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.46", "0.54"]',
    liquidityNum: 250_000,
    volumeNum: 4_000_000,
    closed: false,
    active: true,
    archived: false,
    category: "Economics",
    ...over,
  };
}

test("a live, contested, liquid binary market becomes a candidate", () => {
  const c = toCandidate(raw(), NOW);
  assert.ok(c);
  assert.equal(c.question, "Will the Fed cut rates at the December 2026 meeting?");
  assert.equal(c.url, "https://polymarket.com/market/fed-cut-december-2026");
  assert.equal(c.probability, 0.46);
  assert.equal(c.liquidityUsd, 250_000);
  assert.equal(c.category, "Economics");
});

test("prices are read against the yes outcome, not by position", () => {
  const flipped = toCandidate(
    raw({ outcomes: '["No", "Yes"]', outcomePrices: '["0.54", "0.46"]' }),
    NOW,
  );
  assert.equal(flipped?.probability, 0.46);
});

test("markets that are not open are skipped", () => {
  for (const over of [{ closed: true }, { active: false }, { archived: true }]) {
    assert.equal(toCandidate(raw(over), NOW), null, JSON.stringify(over));
  }
});

test("non-binary and malformed markets are skipped", () => {
  const cases: Array<Record<string, unknown>> = [
    { outcomes: '["Yes", "No", "Maybe"]' },
    { outcomes: '["Trump", "Biden"]' }, // binary but not yes/no
    { outcomes: "not json" },
    { outcomePrices: '["0.46"]' },
    { outcomePrices: '["abc", "def"]' },
    { question: "" },
    { slug: "" },
    { endDate: "not a date" },
    { endDate: undefined },
  ];
  for (const over of cases) {
    assert.equal(toCandidate(raw(over), NOW), null, JSON.stringify(over));
  }
});

test("already-decided questions are skipped at both ends", () => {
  assert.equal(toCandidate(raw({ outcomePrices: '["0.97", "0.03"]' }), NOW), null);
  assert.equal(toCandidate(raw({ outcomePrices: '["0.02", "0.98"]' }), NOW), null);
  // The boundaries themselves are accepted.
  assert.ok(toCandidate(raw({ outcomePrices: `["${MAX_PROBABILITY}", "0.1"]` }), NOW));
  assert.ok(toCandidate(raw({ outcomePrices: `["${MIN_PROBABILITY}", "0.9"]` }), NOW));
});

test("thin books are skipped", () => {
  assert.equal(toCandidate(raw({ liquidityNum: MIN_LIQUIDITY_USD - 1 }), NOW), null);
  assert.ok(toCandidate(raw({ liquidityNum: MIN_LIQUIDITY_USD }), NOW));
  assert.equal(toCandidate(raw({ liquidityNum: undefined }), NOW), null);
});

test("the resolution window is bounded at both ends", () => {
  assert.equal(toCandidate(raw({ endDate: hoursOut(MIN_HOURS_TO_END - 1) }), NOW), null, "too soon");
  assert.ok(toCandidate(raw({ endDate: hoursOut(MIN_HOURS_TO_END) }), NOW), "exactly at the floor");
  assert.equal(toCandidate(raw({ endDate: hoursOut(MAX_HOURS_TO_END + 1) }), NOW), null, "too far out");
  assert.equal(toCandidate(raw({ endDate: hoursOut(-1) }), NOW), null, "already ended");
});

test("outcomes already parsed into arrays are handled too", () => {
  const c = toCandidate(
    raw({ outcomes: ["Yes", "No"], outcomePrices: ["0.46", "0.54"] }),
    NOW,
  );
  assert.equal(c?.probability, 0.46);
});

test("ranking puts the most contested question first", () => {
  const make = (probability: number, liquidityUsd: number, question: string): PolymarketCandidate => ({
    question,
    url: `https://polymarket.com/market/${question}`,
    probability,
    endDate: NOW + 86_400_000,
    liquidityUsd,
    volumeUsd: 0,
    category: "custom",
  });
  const ranked = rankCandidates([
    make(0.85, 900_000, "lopsided"),
    make(0.51, 10_000, "contested"),
    make(0.7, 500_000, "leaning"),
  ]);
  assert.deepEqual(ranked.map((c) => c.question), ["contested", "leaning", "lopsided"]);
});

test("liquidity breaks ties between equally contested questions", () => {
  const make = (probability: number, liquidityUsd: number, question: string): PolymarketCandidate => ({
    question,
    url: "https://polymarket.com/market/x",
    probability,
    endDate: NOW + 86_400_000,
    liquidityUsd,
    volumeUsd: 0,
    category: "custom",
  });
  const ranked = rankCandidates([make(0.5, 10_000, "thin"), make(0.51, 900_000, "deep")]);
  assert.deepEqual(ranked.map((c) => c.question), ["deep", "thin"]);
});

test("ranking does not mutate its input", () => {
  const input: PolymarketCandidate[] = [
    { question: "a", url: "u", probability: 0.9, endDate: NOW, liquidityUsd: 1, volumeUsd: 0, category: "c" },
    { question: "b", url: "u", probability: 0.5, endDate: NOW, liquidityUsd: 1, volumeUsd: 0, category: "c" },
  ];
  rankCandidates(input);
  assert.deepEqual(input.map((c) => c.question), ["a", "b"]);
});

test("the prompt tells the model to restate rather than copy", () => {
  const prompt = formatPolymarketPrompt([toCandidate(raw(), NOW)!]);
  assert.match(prompt, /Will the Fed cut rates/);
  assert.match(prompt, /46% yes/);
  assert.match(prompt, /polymarket\.com\/market\/fed-cut-december-2026/);
  assert.match(prompt, /not as text to copy/);
  assert.match(prompt, /Do not invent a threshold/);
});

test("an empty candidate list produces no prompt section", () => {
  assert.equal(formatPolymarketPrompt([]), "");
});

test("the source is off unless explicitly switched on", () => {
  const prev = process.env.MARKET_CREATOR_POLYMARKET;
  try {
    delete process.env.MARKET_CREATOR_POLYMARKET;
    assert.equal(isPolymarketEnabled(), false);
    process.env.MARKET_CREATOR_POLYMARKET = "0";
    assert.equal(isPolymarketEnabled(), false);
    process.env.MARKET_CREATOR_POLYMARKET = "1";
    assert.equal(isPolymarketEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.MARKET_CREATOR_POLYMARKET;
    else process.env.MARKET_CREATOR_POLYMARKET = prev;
  }
});
