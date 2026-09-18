/**
 * Bearer API keys for agents.
 *
 * The key is shown once at issue time and only its SHA-256 lands in the
 * database, so a database read does not hand anyone a working credential.
 * Comparison is timing-safe, and owner-gated actions never accept a key at all.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_PREFIX_LIVE = "mk_live_";
export const KEY_PREFIX_TEST = "mk_test_";

/** Enough of the key to identify it in a list without being usable. */
export const KEY_DISPLAY_PREFIX_LENGTH = 16;

export type KeyKind = "live" | "test";

export function generateApiKey(kind: KeyKind = "live"): string {
  const prefix = kind === "test" ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
  return `${prefix}${randomBytes(24).toString("base64url")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The stored, displayable stub: enough to recognise a key, never enough to use it. */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, KEY_DISPLAY_PREFIX_LENGTH);
}

export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Pull a key out of an `authorization: Bearer mk_...` header. */
export function parseApiKeyHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const key = match[1];
  return key.startsWith(KEY_PREFIX_LIVE) || key.startsWith(KEY_PREFIX_TEST) ? key : null;
}
