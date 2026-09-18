/**
 * Copy permissions: grant, list, revoke.
 *
 *   GET    /api/copy/permissions?follower=0x…   what this wallet has granted
 *   POST   /api/copy/permissions                grant one (follower-signed)
 *   DELETE /api/copy/permissions?id=…&follower=0x…   revoke, immediately
 *
 * The surface is behind `MIMIR_FEATURE_COPY_TRADING` and, while it is off,
 * returns 404 rather than accepting grants it cannot act on. Execution lands
 * with the funded agent actions; the policy layer ships first because it is
 * what execution has to obey.
 */
import {
  copyPermissionMessage,
  validateCopyPermission,
  InvalidCopyPermissionError,
  type CopyPermission,
} from "@/lib/copy-trading";
import {
  getPermission,
  listExecutions,
  listPermissions,
  revokePermission,
  savePermission,
} from "@/lib/copy-trading-store";
import { verifyAgentSignature, normalizeAddress } from "@/lib/agents/signature";
import { isFeatureEnabled } from "@/lib/ops/flags";

export const dynamic = "force-dynamic";

function fail(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, reason, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function disabled(): Response {
  return fail(404, "feature_disabled", "copy trading is not enabled on this deployment");
}

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function GET(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) return disabled();

  const url = new URL(req.url);
  const follower = normalizeAddress(url.searchParams.get("follower"));
  if (!follower) return fail(400, "bad_wallet", "follower must be an address");

  const permissions = await listPermissions(follower).catch(() => []);
  const withAudit = await Promise.all(
    permissions.map(async (p) => ({
      ...p,
      // The signature is the follower's own, but there is no reason to serve it back.
      signature: undefined,
      recent: await listExecutions(p.id, 10).catch(() => []),
    })),
  );
  return new Response(JSON.stringify({ permissions: withAudit }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) return disabled();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

  const follower = normalizeAddress(body.follower);
  if (!follower) return fail(400, "bad_wallet", "follower must be an address");

  const id = String(body.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) {
    return fail(400, "bad_id", "id must be 3-64 chars of [a-z0-9-], starting alphanumeric");
  }

  const draft: Omit<CopyPermission, "signature" | "createdAt"> = {
    id,
    follower,
    signalAgentId: String(body.signalAgentId ?? "").trim(),
    executionAgentId: String(body.executionAgentId ?? "").trim(),
    active: true,
    expiresAt: numberOr(body.expiresAt, 0),
    maxPerPositionUsdc: numberOr(body.maxPerPositionUsdc, 0),
    maxDailyUsdc: numberOr(body.maxDailyUsdc, 0),
    maxWeeklyUsdc: numberOr(body.maxWeeklyUsdc, 0),
    maxOpenExposureUsdc: numberOr(body.maxOpenExposureUsdc, 0),
    maxRealizedLossUsdc: numberOr(body.maxRealizedLossUsdc, 0),
    allowedCategories: stringList(body.allowedCategories),
    allowedModes: stringList(body.allowedModes),
    minClaimQuality: numberOr(body.minClaimQuality, 0),
    minPayoutRatio: numberOr(body.minPayoutRatio, 1),
  };

  const permission: CopyPermission = {
    ...draft,
    signature: String(body.signature ?? ""),
    createdAt: Date.now(),
  };

  try {
    validateCopyPermission(permission);
  } catch (err) {
    if (err instanceof InvalidCopyPermissionError) {
      return fail(400, "invalid_permission", err.message);
    }
    throw err;
  }

  const existing = await getPermission(id).catch(() => null);
  if (existing && existing.follower.toLowerCase() !== follower) {
    return fail(409, "permission_exists", "that permission id belongs to another wallet");
  }

  // Signed over the human-readable terms, so what was approved is exactly what
  // the wallet prompt showed.
  const signedOk = await verifyAgentSignature({
    address: follower,
    message: copyPermissionMessage(draft),
    signature: permission.signature,
  });
  if (!signedOk) return fail(401, "bad_signature", "the follower signature does not match");

  await savePermission(permission);
  return new Response(JSON.stringify({ ok: true, id, expiresAt: permission.expiresAt }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isFeatureEnabled("copy_trading")) return disabled();

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") ?? "").trim();
  const follower = normalizeAddress(url.searchParams.get("follower"));
  if (!id || !follower) return fail(400, "bad_request", "id and follower are required");

  // Revocation takes no signature on purpose: stopping is never the dangerous
  // direction, and needing a wallet prompt to stop losing money is a trap.
  const revoked = await revokePermission(id, follower);
  if (revoked === 0) return fail(404, "not_found", "no active permission with that id");

  return new Response(JSON.stringify({ ok: true, revoked: id }), {
    headers: { "content-type": "application/json" },
  });
}
