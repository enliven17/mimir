/**
 * GET /api/live — platform liveness probe.
 *
 * Always 200 when the web process can serve a request. Deliberately decoupled
 * from worker health: a stalled oracle is an ops problem, not a reason for a
 * host to restart or de-route the web tier. Use /api/health for that.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify({ ok: true, at: Date.now() }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
