/**
 * Best-effort in-memory per-key rate limiter (fixed window).
 *
 * On serverless this is per-instance only, so it blunts bursts against a warm
 * instance rather than enforcing a hard global cap.
 * ponytail: in-memory fixed window; move to Redis if you outgrow one node.
 */

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();

  // Opportunistic prune so the map can't grow unbounded.
  if (buckets.size > 5000) {
    for (const [k, w] of buckets) if (now >= w.resetAt) buckets.delete(k);
  }

  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterMs: 0 };
  }
  if (w.count >= limit) return { ok: false, retryAfterMs: w.resetAt - now };
  w.count++;
  return { ok: true, retryAfterMs: 0 };
}

/** Best-effort client IP from proxy headers (Vercel/Railway set x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
