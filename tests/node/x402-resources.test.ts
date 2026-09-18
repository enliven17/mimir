import test from "node:test";
import assert from "node:assert/strict";

import { X402_RESOURCES, priceOf, resourceCatalogue } from "../../lib/x402-resources";
import { parsePriceUsd } from "../../lib/x402-revenue";

test("every advertised price parses into a positive amount", () => {
  for (const [key, meta] of Object.entries(X402_RESOURCES)) {
    assert.match(meta.price, /^\$\d+(\.\d+)?$/, `${key} has a malformed price`);
    assert.ok(parsePriceUsd(meta.price) > 0, `${key} advertises a non-positive price`);
  }
});

test("priceOf returns what the catalogue declares", () => {
  assert.equal(priceOf("oracle"), X402_RESOURCES.oracle.price);
  assert.equal(priceOf("councilVote"), "$0.001");
});

test("every resource carries what a buying agent needs to decide", () => {
  for (const [key, meta] of Object.entries(X402_RESOURCES)) {
    assert.match(meta.path, /^\/api\//, `${key} needs an absolute path`);
    assert.ok(meta.description.length > 40, `${key} needs a real description`);
    assert.ok(meta.tags.length > 0, `${key} needs tags`);
    assert.ok(meta.exampleRequest.includes(meta.path), `${key}'s example must call its own path`);
    assert.match(meta.exampleRequest, new RegExp(`^${meta.method}\\b`), `${key}'s example must use its method`);
  }
});

test("paths are unique, so two resources cannot claim one route", () => {
  const paths = Object.values(X402_RESOURCES).map((r) => `${r.method} ${r.path}`);
  assert.equal(new Set(paths).size, paths.length);
});

test("per-persona resources are the ones whose revenue routes to a persona", () => {
  const perPersona = Object.entries(X402_RESOURCES)
    .filter(([, m]) => m.payTo === "persona")
    .map(([k]) => k)
    .sort();
  assert.deepEqual(perPersona, ["councilPreflight", "councilReasoning", "councilVote"]);
});

test("the catalogue builds absolute URLs and tolerates a trailing slash", () => {
  const withSlash = resourceCatalogue("https://mimir.example/");
  const without = resourceCatalogue("https://mimir.example");
  assert.deepEqual(withSlash, without);
  for (const r of without) {
    assert.equal(r.url, `https://mimir.example${r.path}`);
  }
});
