/**
 * Per-instance memoization for expensive async reads (chain scans, RPC
 * fan-outs) that return values `unstable_cache` can't safely store — e.g.
 * bigint fields, which JSON.stringify throws on.
 *
 * Deduped per warm serverless instance only, not shared across instances.
 * That's an acceptable tradeoff here: it still collapses N concurrent/rapid
 * page views into one chain round-trip instead of N.
 */
export function cachedFor<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>,
  ttlMs: number
): (...args: Args) => Promise<T> {
  const cache = new Map<string, { value: Promise<T>; expiresAt: number }>();

  return (...args: Args) => {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value;
    }

    const value = fn(...args);
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  };
}
