import "server-only";

/**
 * Persistence for the agent registry, its keys, nonces and audit trail.
 *
 * Kept out of lib/db.ts so the read-index module does not grow a second
 * responsibility. Everything here is Postgres; there is no in-memory fallback,
 * because an agent registry that forgets its own revocations on restart would
 * be worse than no registry.
 */
import { query } from "@/lib/db";
import {
  defaultLimits,
  isCapability,
  type AgentCapability,
  type AgentLimits,
  type AgentRecord,
  type AgentStatus,
  type AuthorityLevel,
} from "./registry";

function toRecord(row: Record<string, unknown>): AgentRecord {
  const capabilities = String(row.capabilities ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(isCapability);
  let limits: AgentLimits;
  try {
    limits = { ...defaultLimits(), ...(JSON.parse(String(row.limits_json ?? "{}")) as Partial<AgentLimits>) };
  } catch {
    limits = defaultLimits();
  }
  return {
    agentId: String(row.agent_id),
    ownerWallet: String(row.owner_wallet),
    operatorWallet: String(row.operator_wallet),
    payoutWallet: String(row.payout_wallet),
    displayName: String(row.display_name ?? ""),
    authorityLevel: Number(row.authority_level ?? 0) as AuthorityLevel,
    capabilities,
    status: String(row.status ?? "active") as AgentStatus,
    limits,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
  };
}

export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  const rows = await query("SELECT * FROM agent_registry WHERE agent_id = ?", [agentId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listAgents(limit = 100): Promise<AgentRecord[]> {
  const rows = await query(
    "SELECT * FROM agent_registry WHERE status <> 'revoked' ORDER BY created_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(toRecord);
}

export interface CreateAgentInput {
  agentId: string;
  ownerWallet: string;
  operatorWallet: string;
  payoutWallet: string;
  displayName: string;
  authorityLevel: AuthorityLevel;
  capabilities: AgentCapability[];
  status?: AgentStatus;
}

export async function createAgent(input: CreateAgentInput, now = Date.now()): Promise<AgentRecord> {
  const limits = defaultLimits();
  await query(
    `INSERT INTO agent_registry
       (agent_id, owner_wallet, operator_wallet, payout_wallet, display_name,
        authority_level, capabilities, status, limits_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.agentId,
      input.ownerWallet.toLowerCase(),
      input.operatorWallet.toLowerCase(),
      input.payoutWallet.toLowerCase(),
      input.displayName,
      input.authorityLevel,
      input.capabilities.join(","),
      input.status ?? "active",
      JSON.stringify(limits),
      now,
      now,
    ],
  );
  const created = await getAgent(input.agentId);
  if (!created) throw new Error("agent insert did not persist");
  return created;
}

export async function setAgentStatus(agentId: string, status: AgentStatus, now = Date.now()): Promise<void> {
  const clearCapabilities = status === "revoked";
  await query(
    `UPDATE agent_registry
        SET status = ?, updated_at = ?${clearCapabilities ? ", capabilities = ''" : ""}
      WHERE agent_id = ?`,
    [status, now, agentId],
  );
}

export async function rotateOperator(agentId: string, operatorWallet: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_registry SET operator_wallet = ?, updated_at = ? WHERE agent_id = ?", [
    operatorWallet.toLowerCase(),
    now,
    agentId,
  ]);
}

export async function touchAgent(agentId: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_registry SET last_seen_at = ? WHERE agent_id = ?", [now, agentId]);
}

// ── API keys ────────────────────────────────────────────────────────────────

export interface ApiKeyRow {
  keyHash: string;
  agentId: string;
  keyPrefix: string;
  label: string;
  createdAt: number;
  revokedAt: number | null;
}

export async function insertApiKey(row: Omit<ApiKeyRow, "revokedAt">): Promise<void> {
  await query(
    "INSERT INTO agent_api_keys(key_hash, agent_id, key_prefix, label, created_at) VALUES (?, ?, ?, ?, ?)",
    [row.keyHash, row.agentId, row.keyPrefix, row.label, row.createdAt],
  );
}

export async function listApiKeys(agentId: string): Promise<ApiKeyRow[]> {
  const rows = await query(
    "SELECT * FROM agent_api_keys WHERE agent_id = ? ORDER BY created_at DESC",
    [agentId],
  );
  return rows.map((r) => ({
    keyHash: String(r.key_hash),
    agentId: String(r.agent_id),
    keyPrefix: String(r.key_prefix),
    label: String(r.label ?? ""),
    createdAt: Number(r.created_at ?? 0),
    revokedAt: r.revoked_at === null || r.revoked_at === undefined ? null : Number(r.revoked_at),
  }));
}

/** Resolve a presented key to its agent. Revoked keys resolve to nothing. */
export async function agentIdForKeyHash(keyHash: string): Promise<string | null> {
  const rows = await query(
    "SELECT agent_id FROM agent_api_keys WHERE key_hash = ? AND revoked_at IS NULL",
    [keyHash],
  );
  return rows[0] ? String(rows[0].agent_id) : null;
}

export async function revokeApiKey(agentId: string, keyPrefix: string, now = Date.now()): Promise<number> {
  const rows = await query(
    `UPDATE agent_api_keys SET revoked_at = ?
      WHERE agent_id = ? AND key_prefix = ? AND revoked_at IS NULL
      RETURNING key_hash`,
    [now, agentId, keyPrefix],
  );
  return rows.length;
}

export async function revokeAllApiKeys(agentId: string, now = Date.now()): Promise<void> {
  await query("UPDATE agent_api_keys SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL", [
    now,
    agentId,
  ]);
}

// ── Nonces, idempotency, audit ──────────────────────────────────────────────

/** Returns false when the nonce was already used. Atomic: the primary key decides. */
export async function consumeNonce(agentId: string, nonce: string, now = Date.now()): Promise<boolean> {
  const rows = await query(
    "INSERT INTO agent_api_nonces(nonce, agent_id, at) VALUES (?, ?, ?) ON CONFLICT (nonce) DO NOTHING RETURNING nonce",
    [`${agentId}:${nonce}`, agentId, now],
  );
  return rows.length > 0;
}

/** Nonces only need to outlive the envelope skew window. */
export async function pruneNonces(olderThanMs: number, now = Date.now()): Promise<void> {
  await query("DELETE FROM agent_api_nonces WHERE at < ?", [now - olderThanMs]);
}

/**
 * Housekeeping for the append-only agent tables. Nonces outlive the 5 minute
 * skew window by a wide margin, idempotent answers are kept a day, and the
 * audit trail a month (the rate limiter only ever looks back an hour).
 */
export async function pruneAgentTables(now = Date.now()): Promise<void> {
  await pruneNonces(3_600_000, now);
  await query("DELETE FROM agent_api_responses WHERE at < ?", [now - 86_400_000]);
  await query("DELETE FROM agent_request_audit WHERE at < ?", [now - 30 * 86_400_000]);
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

export async function getStoredResponse(
  agentId: string,
  idempotencyKey: string,
  action: string,
): Promise<StoredResponse | null> {
  const rows = await query(
    "SELECT status, response FROM agent_api_responses WHERE idempotency_key = ? AND agent_id = ? AND action = ?",
    [`${agentId}:${idempotencyKey}`, agentId, action],
  );
  if (!rows[0]) return null;
  try {
    return { status: Number(rows[0].status ?? 200), body: JSON.parse(String(rows[0].response)) };
  } catch {
    return null;
  }
}

export async function storeResponse(
  agentId: string,
  idempotencyKey: string,
  action: string,
  status: number,
  body: unknown,
  now = Date.now(),
): Promise<void> {
  await query(
    `INSERT INTO agent_api_responses(idempotency_key, agent_id, action, status, response, at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
    [`${agentId}:${idempotencyKey}`, agentId, action, status, JSON.stringify(body), now],
  );
}

export async function recordRequest(
  agentId: string,
  action: string,
  ok: boolean,
  reason: string | null,
  now = Date.now(),
): Promise<void> {
  await query("INSERT INTO agent_request_audit(agent_id, action, ok, reason, at) VALUES (?, ?, ?, ?, ?)", [
    agentId,
    action,
    ok,
    reason,
    now,
  ]);
}

/** Only allowed calls count: failures are anyone's to send and must not rate-limit the agent. */
export async function requestsLastHour(agentId: string, now = Date.now()): Promise<number> {
  const rows = await query("SELECT COUNT(*) AS n FROM agent_request_audit WHERE agent_id = ? AND ok AND at > ?", [
    agentId,
    now - 3_600_000,
  ]);
  return Number(rows[0]?.n ?? 0);
}
