import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateJsonSpec,
  evaluatePriceSpec,
  parseResolverSpec,
  priceSpecFromQuestion,
  readPath,
  resolverLine,
  winnerFor,
} from "../../lib/resolver-spec";

test("a settlement rule's resolver line parses, and junk does not", () => {
  const rule = `Settle from CoinGecko at the deadline.\n${resolverLine({ kind: "price", symbol: "BTC", op: ">", threshold: 100000 })}`;
  assert.deepEqual(parseResolverSpec(rule), { kind: "price", symbol: "BTC", op: ">", threshold: 100000 });

  assert.equal(parseResolverSpec("no resolver here"), null);
  assert.equal(parseResolverSpec('resolver: {"kind":"price","symbol":"BTC","op":"==","threshold":1}'), null);
  assert.equal(parseResolverSpec('resolver: {"kind":"json","url":"http://x","path":"a","op":"==","value":1}'), null, "https only");
  assert.equal(parseResolverSpec('resolver: {"kind":"json","url":"https://x","path":"a","op":">","value":"text"}'), null);
  assert.equal(parseResolverSpec("resolver: {not json}"), null);
});

test("price specs need every source on the same side", () => {
  const spec = { kind: "price", symbol: "BTC", op: ">", threshold: 100 } as const;
  const r = (priceUsd: number, source = "s") => ({ source, priceUsd });
  const met = evaluatePriceSpec(spec, [r(101), r(102)]);
  assert.ok(met.determined && met.conditionMet);
  const unmet = evaluatePriceSpec(spec, [r(99), r(100)]);
  assert.ok(unmet.determined && !unmet.conditionMet, "exactly at the threshold is not above it");
  assert.equal(evaluatePriceSpec(spec, [r(99), r(101)]).determined, false);
  assert.equal(evaluatePriceSpec(spec, [r(101)]).determined, false);
});

test("json specs read a path and compare", () => {
  const data = { data: { items: [{ score: 3, status: "FINAL" }] } };
  assert.equal(readPath(data, "data.items[0].score"), 3);
  assert.equal(readPath(data, "data.items[5].score"), undefined);

  const out = evaluateJsonSpec({ kind: "json", url: "https://x", path: "data.items[0].status", op: "==", value: "FINAL" }, data);
  assert.ok(out.determined && out.conditionMet);
  assert.equal(evaluateJsonSpec({ kind: "json", url: "https://x", path: "data.nope", op: "==", value: 1 }, data).determined, false);
});

test("a met condition maps to a side only for Yes/No positions", () => {
  assert.equal(winnerFor(true, "Yes — momentum", "No"), "CREATOR_WINS");
  assert.equal(winnerFor(false, "Yes", "No"), "CHALLENGERS_WIN");
  assert.equal(winnerFor(true, "No", "Yes"), "CHALLENGERS_WIN");
  assert.equal(winnerFor(true, "Bulls", "Bears"), null);
});

test("the market creator only writes a spec for unambiguous thresholds", () => {
  assert.deepEqual(priceSpecFromQuestion("Will BTC close above $100k?", "BTC", 100000), { kind: "price", symbol: "BTC", op: ">", threshold: 100000 });
  assert.deepEqual(priceSpecFromQuestion("Will ETH trade below $2,000?", "ETH", 2000)?.op, "<");
  assert.equal(priceSpecFromQuestion("Will BTC reach $100k?", "BTC", 100000), null);
});
