import "server-only";

import { query } from "@/lib/db";

/**
 * Fixed-window request counter in Postgres, shared across serverless
 * instances. One statement per check: the upsert both counts and reads.
 *
 * Fails open: a database hiccup must not take down the routes it guards, and
 * the LLM providers keep their own quotas as a backstop.
 */
export async function allowRequest(bucket: string, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  try {
    const rows = await query(
      `INSERT INTO rate_limits(bucket_key, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT (bucket_key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [`${bucket}:${key}`, windowStart],
    );
    return Number(rows[0]?.hits ?? 0) <= limit;
  } catch (err) {
    console.warn(`[rate-limit] ${bucket} check failed, allowing:`, err);
    return true;
  }
}

/** Old windows only matter to the cron that deletes them. */
export async function pruneRateLimits(olderThanMs = 86_400_000, now = Date.now()): Promise<void> {
  await query("DELETE FROM rate_limits WHERE window_start < ?", [now - olderThanMs]);
}

/** The caller's IP as the platform proxy reports it. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: { code: "rate_limited", message: "Too many requests, slow down and try again shortly." } }),
    { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) } },
  );
}
