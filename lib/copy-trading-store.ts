import { claimKey, parseChainKey, type ChainKey } from "./chains";
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
    minClaimQuality: Number(policy.minClaimQuality ?? 0),
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
    minClaimQuality: p.minClaimQuality,
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
  chain?: ChainKey;
  executed: boolean;
  skipReason?: CopySkipReason | null;
  stakeUsdc?: number;
  txHash?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO copy_executions(permission_id, claim_id, chain, executed, skip_reason, stake_usdc, tx_hash, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.permissionId,
      args.claimId,
      args.chain ?? "arc",
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
    "SELECT claim_id, chain, executed, skip_reason, stake_usdc, tx_hash, at FROM copy_executions WHERE permission_id = ? ORDER BY at DESC LIMIT ?",
    [permissionId, limit],
  );
  return rows.map((r) => ({
    claimId: Number(r.claim_id ?? 0),
    chain: String(r.chain ?? "arc"),
    executed: Boolean(r.executed),
    skipReason: r.skip_reason === null || r.skip_reason === undefined ? null : String(r.skip_reason),
    stakeUsdc: Number(r.stake_usdc ?? 0),
    txHash: r.tx_hash === null || r.tx_hash === undefined ? null : String(r.tx_hash),
    at: Number(r.at ?? 0),
  }));
}

/**
 * What a permission has already spent and has at risk.
 *
 * Derived from the execution ledger rather than tracked as a running total: a
 * counter that drifts out of sync with the rows is a counter that silently
 * raises somebody's ceiling. Open exposure and realized loss come from joining
 * executed copies against the claims they went into.
 */
export async function loadUsage(permissionId: string, now = Date.now()) {
  const dayAgo = now - 24 * 3_600_000;
  const weekAgo = now - 7 * 24 * 3_600_000;

  const [spend, positions] = await Promise.all([
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN at > ? THEN stake_usdc ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE WHEN at > ? THEN stake_usdc ELSE 0 END), 0) AS week
       FROM copy_executions
       WHERE permission_id = ? AND executed = TRUE`,
      [dayAgo, weekAgo, permissionId],
    ),
    query(
      `SELECT e.claim_id, e.chain, e.stake_usdc, c.state, c.winner_side
         FROM copy_executions e
         LEFT JOIN claims c ON c.chain = e.chain AND c.id = e.claim_id
        WHERE e.permission_id = ? AND e.executed = TRUE`,
      [permissionId],
    ),
  ]);

  let openExposureUsdc = 0;
  let realizedLossUsdc = 0;
  const heldClaimIds: string[] = [];

  for (const row of positions) {
    const stake = Number(row.stake_usdc ?? 0);
    const state = String(row.state ?? "");
    const claimId = Number(row.claim_id ?? 0);
    heldClaimIds.push(claimKey(parseChainKey(row.chain, "arc"), claimId));

    if (state === "resolved") {
      // The copy sits on the challenger side, so a creator win is a total loss
      // of the stake. Draws and unresolvable outcomes refund in full.
      if (String(row.winner_side ?? "") === "creator") realizedLossUsdc += stake;
    } else {
      // Unsettled, or not in the read index yet: treat it as still at risk,
      // which is the direction that protects the follower's ceiling.
      openExposureUsdc += stake;
    }
  }

  return {
    spentTodayUsdc: Number(spend[0]?.today ?? 0),
    spentThisWeekUsdc: Number(spend[0]?.week ?? 0),
    openExposureUsdc,
    realizedLossUsdc,
    heldClaimIds,
  };
}

/** Active, unexpired permissions naming this agent as the executor. */
export async function permissionsForExecutor(
  executionAgentId: string,
  now = Date.now(),
): Promise<CopyPermission[]> {
  const rows = await query(
    `SELECT * FROM copy_permissions
      WHERE execution_agent_id = ? AND active = TRUE AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    [executionAgentId, now],
  );
  return rows.map(toPermission);
}
