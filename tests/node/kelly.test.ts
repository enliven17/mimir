import assert from "node:assert/strict";
import test from "node:test";

import { kellyFraction } from "../../lib/kelly";

test("no edge at 50% confidence on even odds", () => {
  assert.equal(kellyFraction(50, 0.25), 0);
});

test("negative edge clamps to zero, never a negative bet", () => {
  assert.equal(kellyFraction(30, 0.25), 0);
  assert.equal(kellyFraction(0, 0.25), 0);
});

test("positive edge below the cap returns the raw Kelly fraction", () => {
  // p=0.6, q=0.4, b=1 → f = 0.2
  assert.ok(Math.abs(kellyFraction(60, 1.0) - 0.2) < 1e-12);
});

test("the cap bounds aggressive edges", () => {
  // p=0.8 → raw f = 0.6, capped per caller
  assert.equal(kellyFraction(80, 0.25), 0.25);
  assert.equal(kellyFraction(80, 0.15), 0.15);
});

test("100% confidence bets exactly the cap", () => {
  assert.equal(kellyFraction(100, 0.25), 0.25);
});
