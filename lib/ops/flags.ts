/**
 * Runtime pause switches and feature flags.
 *
 * Pausing is per capability, set with `MIMIR_PAUSE_<CAPABILITY>=1`, so an
 * incident can close one surface without taking the product down. Reading
 * markets and withdrawing money are deliberately not pausable: whatever else
 * breaks, a user must always be able to see state and get their money out.
 */

export const PAUSABLE = [
  "create_market",
  "stake",
  "copy_execution",
  "x402_selling",
  "x402_buying",
  "oracle_settlement",
  "market_creator_worker",
  "council_worker",
] as const;

export const NEVER_PAUSABLE = ["withdraw", "read_markets", "read_reasoning"] as const;

export type Pausable = (typeof PAUSABLE)[number];

export const FEATURES = [
  "copy_trading",
  "source_drafts",
  "xmtp_chat",
  "council_settlement",
  "council_self_resolving",
  "auto_challenge",
] as const;

export type Feature = (typeof FEATURES)[number];

function envTrue(key: string): boolean {
  const v = process.env[key];
  return v === "1" || v?.toLowerCase() === "true";
}

export function isPaused(capability: Pausable): boolean {
  return envTrue(`MIMIR_PAUSE_${capability.toUpperCase()}`);
}

export function pausedCapabilities(): Pausable[] {
  return PAUSABLE.filter(isPaused);
}

/**
 * Throws when the capability is paused. Call at the top of any code path that
 * moves money, so a pause takes effect before a signature is produced.
 */
export function assertNotPaused(capability: Pausable): void {
  if (isPaused(capability)) {
    throw new Error(`capability_paused:${capability}`);
  }
}

/**
 * Which pause switch guards an escrow write. Withdrawing, cancelling your own
 * open claim and pulling fees get money out, so nothing pauses them.
 */
export function capabilityForEscrowCall(functionName: string): Pausable | null {
  switch (functionName) {
    case "createClaim":
    case "createRematch":
      return "create_market";
    case "challengeClaim":
      return "stake";
    case "resolveClaim":
      return "oracle_settlement";
    default:
      return null;
  }
}

/** Worker-level switches: a paused worker skips its whole cycle. */
export function capabilityForWorker(worker: string): Pausable | null {
  if (worker === "market_creator") return "market_creator_worker";
  if (worker === "council") return "council_worker";
  return null;
}

export function isFeatureEnabled(feature: Feature): boolean {
  return envTrue(`MIMIR_FEATURE_${feature.toUpperCase()}`);
}
