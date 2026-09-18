import test from "node:test";
import assert from "node:assert/strict";

import {
  crossCheckThreshold,
  settlementAdjustment,
  extractUsdThresholds,
  detectAssetSymbol,
  priceCheckTarget,
  MAX_SOURCE_SPREAD,
  MAX_READING_AGE_MS,
  AGREEMENT_CONFIDENCE_BONUS,
  type PriceReading,
} from "../../lib/price-consensus";

const NOW = 1_800_000_000_000;

const reading = (source: "coingecko" | "coinmarketcap", priceUsd: number, ageMs = 0): PriceReading => ({
  source,
  priceUsd,
  at: NOW - ageMs,
});

test("both sources above the threshold agree", () => {
  const r = crossCheckThreshold(
    [reading("coingecko", 101_000), reading("coinmarketcap", 100_900)],
    100_000,
    NOW,
  );
  assert.equal(r.verdict, "agree_above");
  assert.ok(r.spread < 0.01);
});

test("both sources at or below the threshold agree", () => {
  assert.equal(
    crossCheckThreshold([reading("coingecko", 99_000), reading("coinmarketcap", 99_100)], 100_000, NOW).verdict,
    "agree_below",
  );
  // Exactly at the threshold is not above it.
  assert.equal(
    crossCheckThreshold([reading("coingecko", 100_000), reading("coinmarketcap", 100_000)], 100_000, NOW).verdict,
    "agree_below",
  );
});

test("sources straddling the threshold cannot settle the claim", () => {
  const r = crossCheckThreshold(
    [reading("coingecko", 100_050), reading("coinmarketcap", 99_950)],
    100_000,
    NOW,
  );
  assert.equal(r.verdict, "disagree");
  assert.equal(r.reason, "straddles_threshold");

  const adjustment = settlementAdjustment(r);
  assert.equal(adjustment.forceUnresolvable, true);
  assert.equal(adjustment.confidenceDelta, 0);
  assert.match(adjustment.note, /opposite sides/);
});

test("a wide spread is a broken source, even when both land on the same side", () => {
  const r = crossCheckThreshold(
    [reading("coingecko", 120_000), reading("coinmarketcap", 101_000)],
    100_000,
    NOW,
  );
  assert.equal(r.verdict, "disagree");
  assert.equal(r.reason, "spread_too_wide");
  assert.ok(r.spread > MAX_SOURCE_SPREAD);
  assert.equal(settlementAdjustment(r).forceUnresolvable, true);
});

test("the spread tolerance boundary is inclusive", () => {
  const high = 100_000;
  const low = high * (1 - MAX_SOURCE_SPREAD);
  assert.equal(
    crossCheckThreshold([reading("coingecko", high), reading("coinmarketcap", low)], 50_000, NOW).verdict,
    "agree_above",
    "exactly at the tolerance still agrees",
  );
  assert.equal(
    crossCheckThreshold([reading("coingecko", high), reading("coinmarketcap", low - 1)], 50_000, NOW).verdict,
    "disagree",
  );
});

test("agreement earns a confidence bonus, and says why on chain", () => {
  const r = crossCheckThreshold(
    [reading("coingecko", 101_000), reading("coinmarketcap", 100_900)],
    100_000,
    NOW,
  );
  const adjustment = settlementAdjustment(r);
  assert.equal(adjustment.forceUnresolvable, false);
  assert.equal(adjustment.confidenceDelta, AGREEMENT_CONFIDENCE_BONUS);
  assert.match(adjustment.note, /coingecko/);
  assert.match(adjustment.note, /coinmarketcap/);
});

test("one source is not a cross-check, and does not block settlement", () => {
  const r = crossCheckThreshold([reading("coingecko", 101_000)], 100_000, NOW);
  assert.equal(r.verdict, "insufficient");
  const adjustment = settlementAdjustment(r);
  assert.equal(adjustment.forceUnresolvable, false);
  assert.equal(adjustment.confidenceDelta, 0);
});

test("a stale reading does not count as a source", () => {
  const r = crossCheckThreshold(
    [reading("coingecko", 101_000), reading("coinmarketcap", 100_900, MAX_READING_AGE_MS + 1)],
    100_000,
    NOW,
  );
  assert.equal(r.verdict, "insufficient");
  assert.equal(r.reason, "stale_reading");
  assert.match(settlementAdjustment(r).note, /one fresh price source/);
});

test("junk readings are discarded rather than settled on", () => {
  for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = crossCheckThreshold(
      [reading("coingecko", 101_000), reading("coinmarketcap", price)],
      100_000,
      NOW,
    );
    assert.equal(r.verdict, "insufficient", String(price));
  }
});

test("an invalid threshold falls back rather than guessing", () => {
  for (const threshold of [0, -5, Number.NaN]) {
    const r = crossCheckThreshold(
      [reading("coingecko", 101_000), reading("coinmarketcap", 100_900)],
      threshold,
      NOW,
    );
    assert.equal(r.verdict, "insufficient", String(threshold));
  }
});

test("thresholds are read with their magnitude suffixes", () => {
  assert.deepEqual(extractUsdThresholds("Will BTC close above $100,000?"), [100_000]);
  assert.deepEqual(extractUsdThresholds("above $100k"), [100_000]);
  assert.deepEqual(extractUsdThresholds("a $1.5M cap"), [1_500_000]);
  assert.deepEqual(extractUsdThresholds("4000 USD"), [4_000]);
  assert.deepEqual(extractUsdThresholds("no numbers here"), []);
});

test("one asset is detected, an ambiguous pair is not", () => {
  assert.equal(detectAssetSymbol("Will BTC close above $100,000?"), "BTC");
  assert.equal(detectAssetSymbol("Will Bitcoin close above $100,000?"), "BTC");
  assert.equal(detectAssetSymbol("Will ethereum flip solana?"), null, "two assets is not priceable");
  assert.equal(detectAssetSymbol("Will it rain in Paris?"), null);
});

test("only single-asset, single-threshold claims are cross-checked", () => {
  assert.deepEqual(
    priceCheckTarget("Will BTC close above $100,000 on 2026-05-25?"),
    { symbol: "BTC", threshold: 100_000 },
  );
  assert.equal(
    priceCheckTarget("Will BTC trade between $90,000 and $100,000?"),
    null,
    "a range is not one threshold",
  );
  assert.equal(priceCheckTarget("Will BTC beat ETH this month?"), null);
  assert.equal(priceCheckTarget("Will the Fed cut rates in December?"), null);
});
