import "server-only";

/**
 * Persistence for copy permissions and the execution audit trail.
 *
 * Refused copies are recorded alongside executed ones. A log that only shows
 * what happened cannot answer the question a follower actually asks, which is
 * why their agent did not copy something.
 */
import { query } from "@/lib/db";
import type { CopyPermission, CopySkipReason } from "@/lib/copy-trading";

type PolicyFields = Omit<
  CopyPermission,
  "id" | "follower" | "signalAgentId" | "executionAgentId" | "active" | "expiresAt" | "signature" | "createdAt"
>;

function toPermission(r: Record<string, unknown>): CopyPermission {
  let policy: Partial<PolicyFields> = {};
  try {
    policy = JSON.parse(String(r.policy_json ?? "{}")) as Partial<PolicyFields>;
  } catch {
    policy = {};
  }
  return {
    id: String(r.id),
    follower: String(r.follower),
    signalAgentId: String(r.signal_agent_id),
    executionAgentId: String(r.execution_agent_id),
    active: Boolean(r.active) && (r.revoked_at === null || r.revoked_at === undefined),
    expiresAt: Number(r.expires_at ?? 0),
    maxPerPositionUsdc: Number(policy.maxPerPositionUsdc ?? 0),
    maxDailyUsdc: Number(policy.maxDailyUsdc ?? 0),
    maxWeeklyUsdc: Number(policy.maxWeeklyUsdc ?? 0),
    maxOpenExposureUsdc: Number(policy.maxOpenExposureUsdc ?? 0),
    maxRealizedLossUsdc: Number(policy.maxRealizedLossUsdc ?? 0),
    allowedCategories: policy.allowedCategories ?? [],
    allowedModes: policy.allowedModes ?? [],
    minConfidence: Number(policy.minConfidence ?? 0),
    minPayoutRatio: Number(policy.minPayoutRatio ?? 1),
    signature: String(r.signature ?? ""),
    createdAt: Number(r.created_at ?? 0),
  };
}

export async function savePermission(p: CopyPermission): Promise<void> {
  const policy: PolicyFields = {
    maxPerPositionUsdc: p.maxPerPositionUsdc,
    maxDailyUsdc: p.maxDailyUsdc,
    maxWeeklyUsdc: p.maxWeeklyUsdc,
    maxOpenExposureUsdc: p.maxOpenExposureUsdc,
    maxRealizedLossUsdc: p.maxRealizedLossUsdc,
    allowedCategories: p.allowedCategories,
    allowedModes: p.allowedModes,
    minConfidence: p.minConfidence,
    minPayoutRatio: p.minPayoutRatio,
  };
  await query(
    `INSERT INTO copy_permissions
       (id, follower, signal_agent_id, execution_agent_id, active, expires_at, policy_json, signature, created_at)
     VALUES (?, ?, ?, ?, TRUE, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       active = TRUE,
       revoked_at = NULL,
       expires_at = EXCLUDED.expires_at,
       policy_json = EXCLUDED.policy_json,
       signature = EXCLUDED.signature`,
    [
      p.id,
      p.follower.toLowerCase(),
      p.signalAgentId,
      p.executionAgentId,
      p.expiresAt,
      JSON.stringify(policy),
      p.signature,
      p.createdAt,
    ],
  );
}

export async function listPermissions(follower: string): Promise<CopyPermission[]> {
  const rows = await query(
    "SELECT * FROM copy_permissions WHERE follower = ? ORDER BY created_at DESC",
    [follower.toLowerCase()],
  );
  return rows.map(toPermission);
}

export async function getPermission(id: string): Promise<CopyPermission | null> {
  const rows = await query("SELECT * FROM copy_permissions WHERE id = ?", [id]);
  return rows[0] ? toPermission(rows[0]) : null;
}

/** Revocation is immediate and does not need a countersignature from anyone. */
export async function revokePermission(id: string, follower: string, now = Date.now()): Promise<number> {
  const rows = await query(
    `UPDATE copy_permissions SET active = FALSE, revoked_at = ?
      WHERE id = ? AND follower = ? AND revoked_at IS NULL
      RETURNING id`,
    [now, id, follower.toLowerCase()],
  );
  return rows.length;
}

export async function recordExecution(args: {
  permissionId: string;
  claimId: number;
  executed: boolean;
  skipReason?: CopySkipReason | null;
  stakeUsdc?: number;
  txHash?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO copy_executions(permission_id, claim_id, executed, skip_reason, stake_usdc, tx_hash, at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      args.permissionId,
      args.claimId,
      args.executed,
      args.skipReason ?? null,
      args.stakeUsdc ?? 0,
      args.txHash ?? null,
      Date.now(),
    ],
  );
}

export async function listExecutions(permissionId: string, limit = 50) {
  const rows = await query(
    "SELECT claim_id, executed, skip_reason, stake_usdc, tx_hash, at FROM copy_executions WHERE permission_id = ? ORDER BY at DESC LIMIT ?",
    [permissionId, limit],
  );
  return rows.map((r) => ({
    claimId: Number(r.claim_id ?? 0),
    executed: Boolean(r.executed),
    skipReason: r.skip_reason === null || r.skip_reason === undefined ? null : String(r.skip_reason),
    stakeUsdc: Number(r.stake_usdc ?? 0),
    txHash: r.tx_hash === null || r.tx_hash === undefined ? null : String(r.tx_hash),
    at: Number(r.at ?? 0),
  }));
}
