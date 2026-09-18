/**
 * The agent API wire contract.
 *
 * Every request is the same signed envelope. The body is canonicalized (keys
 * sorted, compact JSON), hashed with keccak256, and that hash goes into a
 * human-readable message the caller signs. The server re-derives the hash from
 * the body it received, so a body cannot be swapped after signing and the
 * signer can read what they are agreeing to before they sign it.
 */
import { keccak256, toBytes } from "viem";

export const AGENT_API_VERSION = "v1";

/**
 * Actions the API accepts today. The funded ones (createMarket, stake, vote)
 * are deliberately absent until the fee-bearing contract is deployed: an
 * endpoint that accepts a call it cannot honour is worse than a 404.
 * `dryRun` already grades them, so an agent can size itself in advance.
 */
export const AGENT_API_ACTIONS = [
  "register",
  "heartbeat",
  "rotateOperator",
  "listPositions",
  "listEarnings",
  "dryRun",
  "issueKey",
  "listKeys",
  "revokeKey",
  "revoke",
] as const;

export type AgentAction = (typeof AGENT_API_ACTIONS)[number];

/** Actions only the owner wallet may authorize, never a bearer key. */
export const OWNER_SIGNED_ACTIONS: AgentAction[] = [
  "register",
  "rotateOperator",
  "issueKey",
  "revokeKey",
  "revoke",
];

/** An envelope older than this is rejected, so a captured request cannot be replayed later. */
export const AGENT_REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface AgentEnvelope {
  version: string;
  agentId: string;
  action: AgentAction;
  idempotencyKey?: string;
  nonce?: string;
  signedAt?: number;
  body: Record<string, unknown>;
  signature?: string;
}

/**
 * Deterministic JSON: object keys sorted, no incidental whitespace. Two clients
 * that serialize the same body must produce the same bytes, or every signature
 * becomes a coin flip.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bodyHash(body: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalize(body ?? {})));
}

/** The exact text a caller signs. Readable on purpose: a signer should see what they approve. */
export function agentRequestMessage(env: AgentEnvelope): string {
  return [
    "Mimir Agent API request",
    `version: ${env.version}`,
    `agent: ${env.agentId}`,
    `action: ${env.action}`,
    `idempotency: ${env.idempotencyKey ?? ""}`,
    `nonce: ${env.nonce ?? ""}`,
    `signedAt: ${env.signedAt ?? 0}`,
    `bodyHash: ${bodyHash(env.body)}`,
  ].join("\n");
}

/** Proof that an operator wallet controls itself, required at registration. */
export function operatorProofMessage(agentId: string, operatorWallet: string): string {
  return `Mimir agent operator proof\nagent: ${agentId}\noperator: ${operatorWallet.toLowerCase()}`;
}

export class AgentEnvelopeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }
}

function isAction(value: unknown): value is AgentAction {
  return typeof value === "string" && (AGENT_API_ACTIONS as readonly string[]).includes(value);
}

/**
 * Structural validation only. Whether the signature is real, the nonce fresh
 * and the agent allowed is decided later, by code that can reach the database.
 */
export function validateAgentRequestEnvelope(
  raw: unknown,
  { action, now = Date.now() }: { action: string; now?: number },
): AgentEnvelope {
  if (!raw || typeof raw !== "object") {
    throw new AgentEnvelopeError("body must be a JSON object", 400, "malformed_envelope");
  }
  const env = raw as Record<string, unknown>;

  if (env.version !== AGENT_API_VERSION) {
    throw new AgentEnvelopeError(`version must be ${AGENT_API_VERSION}`, 400, "bad_version");
  }
  if (!isAction(action)) {
    throw new AgentEnvelopeError(`unknown action ${action}`, 404, "unknown_action");
  }
  if (env.action !== undefined && env.action !== action) {
    throw new AgentEnvelopeError("action does not match the URL", 400, "action_mismatch");
  }
  if (typeof env.agentId !== "string" || !AGENT_ID_PATTERN.test(env.agentId)) {
    throw new AgentEnvelopeError(
      "agentId must be 3-64 chars of [a-z0-9-], starting alphanumeric",
      400,
      "bad_agent_id",
    );
  }
  if (env.body !== undefined && (typeof env.body !== "object" || env.body === null || Array.isArray(env.body))) {
    throw new AgentEnvelopeError("body must be an object", 400, "bad_body");
  }
  for (const field of ["idempotencyKey", "nonce"] as const) {
    const v = env[field];
    if (v !== undefined && (typeof v !== "string" || v.length === 0 || v.length > 128)) {
      throw new AgentEnvelopeError(`${field} must be 1-128 chars`, 400, `bad_${field}`);
    }
  }
  if (env.signedAt !== undefined) {
    if (typeof env.signedAt !== "number" || !Number.isFinite(env.signedAt)) {
      throw new AgentEnvelopeError("signedAt must be a number", 400, "bad_signed_at");
    }
    if (Math.abs(now - env.signedAt) > AGENT_REQUEST_MAX_SKEW_MS) {
      throw new AgentEnvelopeError("signedAt is outside the allowed window", 400, "stale_envelope");
    }
  }
  if (env.signature !== undefined && typeof env.signature !== "string") {
    throw new AgentEnvelopeError("signature must be a string", 400, "bad_signature");
  }

  return {
    version: AGENT_API_VERSION,
    agentId: env.agentId,
    action,
    idempotencyKey: env.idempotencyKey as string | undefined,
    nonce: env.nonce as string | undefined,
    signedAt: env.signedAt as number | undefined,
    body: (env.body as Record<string, unknown>) ?? {},
    signature: env.signature as string | undefined,
  };
}
