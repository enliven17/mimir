/**
 * POST /api/copy/signals — what this execution agent may copy right now.
 *
 * Authenticated as the execution agent, through the same signed envelope every
 * other agent action uses. The response is advice with a size attached, not an
 * instruction that has been carried out: Mimir cannot stake for the follower
 * and does not try to. The agent decides whether to act and signs its own
 * transaction.
 *
 * Reporting back is a separate call (`report: true`), so a copy is recorded
 * against the ledger only once it actually landed on chain.
 */
import {
  AgentEnvelopeError,
  validateAgentRequestEnvelope,
  type AgentEnvelope,
} from "@/lib/agents/api";
import { authenticateAgentRequest } from "@/lib/agents/authenticate";
import { buildCopyInstructions } from "@/lib/server/copy-signals";
import { permissionsForExecutor, recordExecution } from "@/lib/copy-trading-store";
import { isFeatureEnabled } from "@/lib/ops/flags";
import { COPY_SKIP_REASONS, type CopySkipReason } from "@/lib/copy-trading";

export const dynamic = "force-dynamic";

function fail(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, reason, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isSkipReason(value: unknown): value is CopySkipReason {
  return typeof value === "string" && (COPY_SKIP_REASONS as readonly string[]).includes(value);
}

export async function POST(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) {
    return fail(404, "feature_disabled", "copy trading is not enabled on this deployment");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

  let env: AgentEnvelope;
  try {
    // Reuses the heartbeat action so an execution agent needs no extra
    // authority: asking what it may copy is a read, and every funded action it
    // then takes is gated by the permission itself.
    env = validateAgentRequestEnvelope(raw, { action: "heartbeat" });
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    throw err;
  }

  let agentId: string;
  try {
    const { agent } = await authenticateAgentRequest(env, req.headers.get("authorization"));
    agentId = agent.agentId;
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    throw err;
  }

  // Reporting a landed copy back into the ledger.
  const report = env.body.report as Record<string, unknown> | undefined;
  if (report) {
    const permissionId = String(report.permissionId ?? "");
    const claimId = Number(report.claimId ?? 0);
    const executed = report.executed === true;
    if (!permissionId || !Number.isInteger(claimId) || claimId <= 0) {
      return fail(400, "bad_report", "permissionId and claimId are required");
    }
    const permissions = await permissionsForExecutor(agentId).catch(() => []);
    if (!permissions.some((p) => p.id === permissionId)) {
      return fail(403, "not_your_permission", "that permission does not name this agent as its executor");
    }
    await recordExecution({
      permissionId,
      claimId,
      executed,
      skipReason: isSkipReason(report.skipReason) ? report.skipReason : null,
      stakeUsdc: Number(report.stakeUsdc ?? 0) || 0,
      txHash: typeof report.txHash === "string" ? report.txHash : null,
    }).catch(() => undefined);
    return new Response(JSON.stringify({ ok: true, recorded: { permissionId, claimId, executed } }), {
      headers: { "content-type": "application/json" },
    });
  }

  const permissions = await permissionsForExecutor(agentId).catch(() => []);
  const instructions = await buildCopyInstructions(permissions).catch(() => []);

  const copy = instructions.filter((i) => i.decision.allowed);
  const skipped = instructions.filter((i) => !i.decision.allowed);

  return new Response(
    JSON.stringify({
      ok: true,
      executionAgentId: agentId,
      permissions: permissions.length,
      copy: copy.map((i) => ({
        permissionId: i.permissionId,
        claimId: i.claimId,
        signalAgentId: i.signalAgentId,
        question: i.question,
        category: i.category,
        stakeUsdc: i.stakeUsdc,
      })),
      skipped: skipped.map((i) => ({
        permissionId: i.permissionId,
        claimId: i.claimId,
        reason: i.decision.reason,
        message: i.decision.message,
      })),
      // Said plainly, because an endpoint returning stake sizes could be read
      // as having already placed them.
      note: "Nothing has been staked. Place each copy from the follower's wallet, then report it back with { report: { permissionId, claimId, executed, stakeUsdc, txHash } }.",
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
