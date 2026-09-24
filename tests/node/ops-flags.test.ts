import test from "node:test";
import assert from "node:assert/strict";

import {
  isPaused,
  assertNotPaused,
  pausedCapabilities,
  PAUSABLE,
  NEVER_PAUSABLE,
} from "../../lib/ops/flags";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
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

test("a capability is paused only when explicitly switched on", () => {
  withEnv("MIMIR_PAUSE_STAKE", undefined, () => assert.equal(isPaused("stake"), false));
  withEnv("MIMIR_PAUSE_STAKE", "0", () => assert.equal(isPaused("stake"), false));
  withEnv("MIMIR_PAUSE_STAKE", "1", () => assert.equal(isPaused("stake"), true));
  withEnv("MIMIR_PAUSE_STAKE", "true", () => assert.equal(isPaused("stake"), true));
});

test("assertNotPaused throws with the capability name", () => {
  withEnv("MIMIR_PAUSE_CREATE_MARKET", "1", () => {
    assert.throws(() => assertNotPaused("create_market"), /capability_paused:create_market/);
  });
  withEnv("MIMIR_PAUSE_CREATE_MARKET", undefined, () => {
    assert.doesNotThrow(() => assertNotPaused("create_market"));
  });
});

test("pausedCapabilities lists only what is switched on", () => {
  withEnv("MIMIR_PAUSE_X402_BUYING", "1", () => {
    assert.deepEqual(pausedCapabilities(), ["x402_buying"]);
  });
});

test("withdrawing and reading are never pausable", () => {
  for (const cap of NEVER_PAUSABLE) {
    assert.equal((PAUSABLE as readonly string[]).includes(cap), false);
  }
});

test("escrow writes map to the pause switch that guards them", async () => {
  const { capabilityForEscrowCall, capabilityForWorker } = await import("../../lib/ops/flags");
  assert.equal(capabilityForEscrowCall("createClaim"), "create_market");
  assert.equal(capabilityForEscrowCall("createRematch"), "create_market");
  assert.equal(capabilityForEscrowCall("challengeClaim"), "stake");
  assert.equal(capabilityForEscrowCall("resolveClaim"), "oracle_settlement");
  for (const exit of ["withdraw", "cancelClaim", "claimFees"]) {
    assert.equal(capabilityForEscrowCall(exit), null);
  }
  assert.equal(capabilityForWorker("council"), "council_worker");
  assert.equal(capabilityForWorker("oracle"), null);
});
