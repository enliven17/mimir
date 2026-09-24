import test from "node:test";
import assert from "node:assert/strict";

import { confidenceTier, settlementPreview } from "../../lib/settlement-preview";

const base = { resolutionUrl: "https://example.com", category: "crypto", deadline: 1_800_000_000 };

test("the preview follows the oracle's decision order", () => {
  const spec = 'resolver: {"kind":"price","symbol":"BTC","op":">","threshold":100000}';
  assert.equal(settlementPreview({ ...base, question: "Will BTC close above $100k?", settlementRule: spec }).method, "resolver-price");
  assert.equal(settlementPreview({ ...base, question: "Will BTC close above $100k?", settlementRule: "" }).method, "price-consensus");
  assert.equal(settlementPreview({ ...base, question: "Will the album top the charts?", category: "culture" }).method, "evidence-llm");
  assert.equal(settlementPreview({ ...base, question: "Who wins?", category: "sports" }).waitsForFinal, "sports");
  assert.equal(settlementPreview({ ...base, question: "x", resolutionUrl: "https://polymarket.com/event/x" }).waitsForFinal, "polymarket");
});

test("the confidence tier reads what the oracle wrote on chain", () => {
  assert.equal(confidenceTier("creator", 95, "[RESOLVER] BTC > 100000"), "deterministic");
  assert.equal(confidenceTier("creator", 88, "clear evidence"), "firm");
  assert.equal(confidenceTier("challengers", 70, "[CONTESTED] [via-scrape] ..."), "contested");
  assert.equal(confidenceTier("unresolvable", 40, "[LOW CONFIDENCE — refunded]"), "refunded");
  assert.equal(confidenceTier("draw", 90, "tie"), "refunded");
});
