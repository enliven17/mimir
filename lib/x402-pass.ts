/**
 * Subscription passes for x402 endpoints — one nanopayment buys a time-boxed
 * window of free reads (the "recurring"/streaming-access angle).
 *
 * Stateless: a pass is an HMAC-signed `payer.exp.plan` token. No DB — verify by
 * recomputing the MAC. ponytail: bearer token (anyone holding it reuses it until
 * expiry); bind to caller identity + a nonce store if abuse becomes a concern.
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * X402_PASS_SECRET when set. Otherwise a key derived from the entity secret
 * with a fixed label, so the wallet-custody secret itself is never used as a
 * MAC key for tokens handed to the public.
 */
function secret(): string {
  const own = process.env.X402_PASS_SECRET?.trim();
  if (own) return own;
  const entity = process.env.CIRCLE_ENTITY_SECRET?.trim();
  if (!entity) throw new Error("X402_PASS_SECRET (or CIRCLE_ENTITY_SECRET) required to sign passes");
  return createHmac("sha256", entity).update("mimir/x402-pass/v1").digest("base64url");
}

/** Reads a pass may buy over its window; past this it pays per read again. */
export const PASS_READ_LIMIT = Number(process.env.COUNCIL_PASS_READ_LIMIT ?? 100);

/**
 * The pass a request carries: the `x-mimir-pass` header, or the `pass` query
 * parameter for older clients (query strings end up in access logs, headers
 * do not).
 */
export function passFromRequest(req: Request): string | null {
  return req.headers.get("x-mimir-pass") ?? new URL(req.url).searchParams.get("pass");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export interface PassClaims {
  payer: string;
  plan: string;
  exp: number; // ms epoch
}

/** Issue a pass valid for `ttlMs` from now. */
export function issuePass(payer: string, plan: string, ttlMs: number): { pass: string; expiresAt: number } {
  const exp = Date.now() + ttlMs;
  const body = `${payer.toLowerCase()}.${exp}.${plan}`;
  const pass = `${Buffer.from(body).toString("base64url")}.${sign(body)}`;
  return { pass, expiresAt: exp };
}

/** Verify a pass for a given plan. Returns claims when valid + unexpired, else null. */
export function verifyPass(token: string | null | undefined, plan: string): PassClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  const mac = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws otherwise).
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  const [payer, expStr, p] = body.split(".");
  const exp = Number(expStr);
  if (!payer || !Number.isFinite(exp) || p !== plan) return null;
  if (Date.now() > exp) return null;
  return { payer, plan: p, exp };
}
