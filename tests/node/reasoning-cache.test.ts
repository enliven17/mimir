import assert from "node:assert/strict";
import test from "node:test";

import {
  clearReasoningCache,
  getCachedReasoning,
  setCachedReasoning,
} from "../../lib/server/reasoning-cache";

const entry = (reasoning: string) => ({
  question: "Will X happen?",
  sideA: "yes",
  sideB: "no",
  reasoning,
});

test("a stored pair is served back", () => {
  clearReasoningCache();
  setCachedReasoning(1, "optimist", entry("bullish"));
  assert.equal(getCachedReasoning(1, "optimist")?.reasoning, "bullish");
});

test("personas and claims do not bleed into each other", () => {
  clearReasoningCache();
  setCachedReasoning(1, "optimist", entry("bullish"));
  assert.equal(getCachedReasoning(1, "pessimist"), null);
  assert.equal(getCachedReasoning(2, "optimist"), null);
});

test("entries expire, and an expired read regenerates", () => {
  clearReasoningCache();
  const t0 = 1_000_000;
  setCachedReasoning(1, "optimist", entry("stale"), t0);
  assert.equal(getCachedReasoning(1, "optimist", t0 + 9 * 60 * 1000)?.reasoning, "stale");
  assert.equal(getCachedReasoning(1, "optimist", t0 + 11 * 60 * 1000), null);
});

test("the cache is bounded, so a wide claim range cannot grow it without limit", () => {
  clearReasoningCache();
  for (let id = 1; id <= 260; id++) {
    setCachedReasoning(id, "optimist", entry(`r${id}`));
  }
  // Oldest evicted, newest retained.
  assert.equal(getCachedReasoning(1, "optimist"), null);
  assert.equal(getCachedReasoning(260, "optimist")?.reasoning, "r260");
});
