import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** Vercel cron sends `Authorization: Bearer $CRON_SECRET`. Compared in constant time. */
export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${expected}`));
}
