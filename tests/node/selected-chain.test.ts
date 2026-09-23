import assert from "node:assert/strict";
import test from "node:test";

import { resolveSelectedChain } from "../../lib/selectedChain";

test("a stored chain is kept only while its escrow is enabled", () => {
  assert.equal(resolveSelectedChain("base", ["arc", "base"], "arc"), "base");
  assert.equal(resolveSelectedChain("arbitrum", ["arc", "base"], "arc"), "arc");
});

test("garbage in storage falls back to the default chain", () => {
  assert.equal(resolveSelectedChain(null, ["arc", "base"], "arc"), "arc");
  assert.equal(resolveSelectedChain("solana", ["arc", "base"], "base"), "base");
  assert.equal(resolveSelectedChain(42, ["arc"], "arc"), "arc");
});

test("a disabled default falls back to the first enabled chain, then Arc", () => {
  assert.equal(resolveSelectedChain(null, ["base", "arbitrum"], "arc"), "base");
  assert.equal(resolveSelectedChain(null, [], "base"), "arc");
});
