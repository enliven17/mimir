/**
 * First-stake onboarding: the four things a new visitor has to do before they
 * can put USDC behind a claim, each derived from state the app already reads.
 *
 * Nothing here is stored except the dismissal. A step is done because the
 * wallet says so, not because somebody clicked "mark as done", so the list
 * cannot drift from reality.
 */

import { MIN_STAKE } from "./constants";

export const ONBOARDING_STEP_IDS = ["connect", "network", "fund", "stake"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export interface OnboardingInputs {
  isConnected: boolean;
  /** Wallet is currently on Arc. */
  onArc: boolean;
  /** Native USDC on Arc in whole units; null while unknown. */
  arcBalanceUsdc: number | null;
  /** Wallet holds any claim as creator or challenger; null while unknown. */
  hasStake: boolean | null;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
}

export function onboardingSteps(i: OnboardingInputs): OnboardingStep[] {
  // Every later step is about *this* wallet, so none can be done without one.
  const connected = i.isConnected;
  return [
    { id: "connect", done: connected },
    { id: "network", done: connected && i.onArc },
    { id: "fund", done: connected && i.arcBalanceUsdc !== null && i.arcBalanceUsdc >= MIN_STAKE },
    { id: "stake", done: connected && i.hasStake === true },
  ];
}

/** The first step still pending, or null when all are done. */
export function currentOnboardingStep(steps: OnboardingStep[]): OnboardingStepId | null {
  return steps.find((s) => !s.done)?.id ?? null;
}

export const ONBOARDING_DISMISS_KEY = "mimir:onboarding:dismissed";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari private mode and sandboxed iframes throw on access.
    return null;
  }
}

export function readOnboardingDismissed(storage: KeyValueStore | null = browserStorage()): boolean {
  try {
    return storage?.getItem(ONBOARDING_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOnboardingDismissed(storage: KeyValueStore | null = browserStorage()): void {
  try {
    storage?.setItem(ONBOARDING_DISMISS_KEY, "1");
  } catch {
    // Quota or privacy mode: the dismissal just lasts for this page view.
  }
}
