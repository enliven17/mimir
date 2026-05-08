import crypto from "node:crypto";

type CacheEntry<T> = {
  value: T;
  expiresAtMs: number;
};

/**
 * In-memory TTL cache for dev/single-node deployments.
 *
 * Note: In serverless/edge environments this is best-effort and may not persist
 * across invocations. It's still useful to reduce bursty repeated calls in warm
 * instances and to dedupe concurrent requests.
 */
class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();

  get(key: string): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAtMs) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number) {
    const expiresAtMs = Date.now() + Math.max(0, ttlMs);
    this.map.set(key, { value, expiresAtMs });
  }

  delete(key: string) {
    this.map.delete(key);
  }
}

export function hashModerationInput(value: unknown) {
  const json = JSON.stringify(value);
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 24);
}

export const moderationResultCache = new TtlCache<any>();
export const moderationInFlight = new Map<string, Promise<any>>();

let globalCooldownUntilMs = 0;

export function getGlobalCooldownMs() {
  return Math.max(0, globalCooldownUntilMs - Date.now());
}

export function setGlobalCooldownMs(msFromNow: number) {
  globalCooldownUntilMs = Date.now() + Math.max(0, msFromNow);
}

