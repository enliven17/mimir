import test from "node:test";
import assert from "node:assert/strict";

import { creatorChainOrder, rotationFrom } from "../../agents/market-creator/chain-picker";

const ALL = ["arc", "base", "arbitrum"] as const;

test("creatorChainOrder: unset env uses every usable chain in registry order", () => {
  assert.deepEqual(creatorChainOrder(undefined, ALL), ["arc", "base", "arbitrum"]);
  assert.deepEqual(creatorChainOrder("", ["arc", "base"]), ["arc", "base"]);
});

test("creatorChainOrder: env narrows and orders by preference", () => {
  assert.deepEqual(creatorChainOrder("base, arc", ALL), ["base", "arc"]);
  assert.deepEqual(creatorChainOrder("ARBITRUM,base", ALL), ["arbitrum", "base"]);
});

test("creatorChainOrder: drops unknown, duplicate and wallet-less chains", () => {
  assert.deepEqual(creatorChainOrder("solana,base,base,arbitrum", ["arc", "base"]), ["base"]);
});

test("creatorChainOrder: nothing usable in env falls back to all usable chains", () => {
  assert.deepEqual(creatorChainOrder("arbitrum", ["arc", "base"]), ["arc", "base"]);
  assert.deepEqual(creatorChainOrder("nope", []), []);
});

test("rotationFrom: round-robins and keeps the rest as fallbacks", () => {
  assert.deepEqual(rotationFrom(ALL, 0), ["arc", "base", "arbitrum"]);
  assert.deepEqual(rotationFrom(ALL, 1), ["base", "arbitrum", "arc"]);
  assert.deepEqual(rotationFrom(ALL, 5), ["arbitrum", "arc", "base"]);
  assert.deepEqual(rotationFrom(["base"], 7), ["base"]);
  assert.deepEqual(rotationFrom([], 3), []);
});
