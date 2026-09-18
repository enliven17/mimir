/**
 * GET /api/health — ops probe.
 *
 * Reports every worker's heartbeat and returns 503 only when something is
 * critical (a worker that never reported, or one silent for four intervals).
 * A late worker returns 200 with a warn alarm so a slow cycle does not page.
 */

import { evaluateHealth, healthHttpStatus } from "@/lib/ops/health";
import { pausedCapabilities } from "@/lib/ops/flags";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await evaluateHealth();
  const body = { ...report, paused: pausedCapabilities() };
  return new Response(JSON.stringify(body), {
    status: healthHttpStatus(report.status),
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
