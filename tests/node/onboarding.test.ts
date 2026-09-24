import test from "node:test";
import assert from "node:assert/strict";

import {
  ONBOARDING_DISMISS_KEY,
  currentOnboardingStep,
  onboardingSteps,
  readOnboardingDismissed,
  writeOnboardingDismissed,
} from "../../lib/onboarding";

const done = (i: Parameters<typeof onboardingSteps>[0]) =>
  onboardingSteps(i).filter((s) => s.done).map((s) => s.id);

test("a disconnected visitor has every step pending", () => {
  assert.deepEqual(done({ isConnected: false, onArc: true, arcBalanceUsdc: 50, hasStake: true }), []);
});

test("steps are detected independently once connected", () => {
  assert.deepEqual(done({ isConnected: true, onArc: false, arcBalanceUsdc: 5, hasStake: null }), [
    "connect",
    "fund",
  ]);
  assert.deepEqual(done({ isConnected: true, onArc: true, arcBalanceUsdc: 0, hasStake: true }), [
    "connect",
    "network",
    "stake",
  ]);
});

test("funding needs at least the minimum stake, and unknown balance is pending", () => {
  assert.ok(!done({ isConnected: true, onArc: true, arcBalanceUsdc: 1.99, hasStake: false }).includes("fund"));
  assert.ok(done({ isConnected: true, onArc: true, arcBalanceUsdc: 2, hasStake: false }).includes("fund"));
  assert.ok(!done({ isConnected: true, onArc: true, arcBalanceUsdc: null, hasStake: false }).includes("fund"));
});

test("the current step is the first pending one", () => {
  const steps = onboardingSteps({ isConnected: true, onArc: false, arcBalanceUsdc: 10, hasStake: false });
  assert.equal(currentOnboardingStep(steps), "network");
  const all = onboardingSteps({ isConnected: true, onArc: true, arcBalanceUsdc: 10, hasStake: true });
  assert.equal(currentOnboardingStep(all), null);
});

test("dismissal round-trips through storage and survives a throwing store", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(readOnboardingDismissed(store), false);
  writeOnboardingDismissed(store);
  assert.equal(map.get(ONBOARDING_DISMISS_KEY), "1");
  assert.equal(readOnboardingDismissed(store), true);

  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(readOnboardingDismissed(broken), false);
  assert.doesNotThrow(() => writeOnboardingDismissed(broken));
  assert.equal(readOnboardingDismissed(null), false);
});
