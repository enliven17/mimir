import assert from "node:assert/strict";
import test from "node:test";

import { baselineCalls, baselineUsd } from "../../lib/x402-revenue";

function withEnv(key: string, value: string | undefined, fn: () => void) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

const withCalls = (v: string | undefined, fn: () => void) =>
  withEnv("X402_BASELINE_CALLS", v, fn);
const withUsd = (v: string | undefined, fn: () => void) => withEnv("X402_BASELINE_USD", v, fn);

test("unset baseline contributes nothing", () => {
  withCalls(undefined, () => assert.equal(baselineCalls(), 0));
  withUsd(undefined, () => assert.equal(baselineUsd(), 0));
});

test("a configured baseline is carried over", () => {
  withCalls("218000", () => assert.equal(baselineCalls(), 218000));
  withUsd("218", () => assert.equal(baselineUsd(), 218));
});

test("junk, negative, and fractional values never inflate or corrupt the total", () => {
  for (const bad of ["", "not-a-number", "-5", "Infinity", "NaN"]) {
    withCalls(bad, () => assert.equal(baselineCalls(), 0));
    withUsd(bad, () => assert.equal(baselineUsd(), 0));
  }
  withCalls("218000.9", () => assert.equal(baselineCalls(), 218000));
  withUsd("218.0000001", () => assert.equal(baselineUsd(), 218));
});
