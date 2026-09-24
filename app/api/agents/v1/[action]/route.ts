/**
 * POST /api/agents/v1/{action} — the agent API.
 *
 * One signed envelope format for everything. Errors are explicit: 400 for a
 * malformed envelope, 401 for a rejected credential, 403 with a named reason
 * when authority, capability or a budget refuses the action, 404 for an unknown
 * agent or action, 409 for a replayed nonce or a taken agent id.
 */
import {
  AgentEnvelopeError,
  agentRequestMessage,
  operatorProofMessage,
  validateAgentRequestEnvelope,
  type AgentEnvelope,
} from "@/lib/agents/api";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/agents/api-keys";
import { authenticateAgentRequest } from "@/lib/agents/authenticate";
import { dryRun } from "@/lib/agents/dry-run";
import {
  authorizeAction,
  isAuthorityLevel,
  isCapability,
  grantableCapabilities,
  type AgentCapability,
  type AgentRecord,
  type AuthorityLevel,
} from "@/lib/agents/registry";
import { verifyAgentSignature, normalizeAddress } from "@/lib/agents/signature";
import {
  consumeNonce,
  createAgent,
  getAgent,
  getStoredResponse,
  insertApiKey,
  listApiKeys,
  recordRequest,
  requestsLastHour,
  revokeAllApiKeys,
  revokeApiKey,
  rotateOperator,
  setAgentStatus,
  storeResponse,
  touchAgent,
} from "@/lib/agents/store";
import { getClaimsByChallenger, getClaimsByFilter, getX402RevenueSummary } from "@/lib/db";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ action: string }>;
}

function fail(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, reason, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...(data as object) }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { action } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "malformed_json", "body is not valid JSON");
  }

  let env: AgentEnvelope;
  try {
    env = validateAgentRequestEnvelope(raw, { action });
  } catch (err) {
    if (err instanceof AgentEnvelopeError) return fail(err.status, err.reason, err.message);
    throw err;
  }

  try {
    const result = env.action === "register"
      ? await handleRegister(env)
      : await handleAuthenticated(env, req.headers.get("authorization"));

    if (env.idempotencyKey && !result.replay) {
      await storeResponse(env.agentId, env.idempotencyKey, env.action, result.status, storable(env.action, result.body))
        .catch(() => undefined);
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: {
        "content-type": "application/json",
        ...(result.replay ? { "idempotent-replay": "true" } : {}),
      },
    });
  } catch (err) {
    if (err instanceof AgentEnvelopeError) {
      // Unknown ids are not audited, or anyone could grow the table without bound.
      if (err.reason !== "unknown_agent" && env.action !== "register") {
        await recordRequest(env.agentId, env.action, false, err.reason).catch(() => undefined);
      }
      return fail(err.status, err.reason, err.message);
    }
    console.error("[agents/v1] unhandled:", err);
    return fail(500, "internal_error", "the request could not be completed");
  }
}

interface Handled {
  status: number;
  body: unknown;
  replay?: boolean;
}

/**
 * Runs only after the caller has proven who they are. A retry with the same
 * idempotency key and action replays the stored answer rather than executing
 * again; issuing two API keys because a socket hiccuped is not a retry, it is a
 * second key nobody knows about. Otherwise the nonce is burned here.
 */
async function replayOrConsumeNonce(env: AgentEnvelope, nonce: string | null): Promise<Handled | null> {
  if (env.idempotencyKey) {
    const stored = await getStoredResponse(env.agentId, env.idempotencyKey, env.action).catch(() => null);
    if (stored) return { ...stored, replay: true };
  }
  if (nonce && !(await consumeNonce(env.agentId, nonce))) {
    throw new AgentEnvelopeError("nonce already used", 409, "nonce_replay");
  }
  return null;
}

/** A freshly issued key is shown once and never persisted, not even in the replay table. */
function storable(action: string, body: unknown): unknown {
  if (action !== "issueKey" || !body || typeof body !== "object") return body;
  const { key: _key, ...rest } = body as Record<string, unknown>;
  return { ...rest, key: null, note: "the key was shown once; revoke it by prefix if it was lost" };
}

// ── register ────────────────────────────────────────────────────────────────

async function handleRegister(env: AgentEnvelope): Promise<Handled> {
  const ownerWallet = normalizeAddress(env.body.ownerWallet);
  const operatorWallet = normalizeAddress(env.body.operatorWallet);
  const payoutWallet = normalizeAddress(env.body.payoutWallet) ?? ownerWallet;
  if (!ownerWallet || !operatorWallet || !payoutWallet) {
    throw new AgentEnvelopeError("ownerWallet and operatorWallet must be addresses", 400, "bad_wallets");
  }

  const authorityLevel = env.body.authorityLevel ?? 0;
  if (!isAuthorityLevel(authorityLevel)) {
    throw new AgentEnvelopeError("authorityLevel must be 0-4", 400, "bad_authority");
  }

  const requested = Array.isArray(env.body.capabilities) ? env.body.capabilities : [];
  const capabilities = requested.filter(isCapability) as AgentCapability[];
  if (capabilities.length !== requested.length) {
    throw new AgentEnvelopeError("unknown capability requested", 400, "bad_capability");
  }
  const grantable = grantableCapabilities(authorityLevel as AuthorityLevel);
  const overreach = capabilities.filter((c) => !grantable.includes(c));
  if (overreach.length > 0) {
    throw new AgentEnvelopeError(
      `${overreach.join(", ")} needs a higher authority level`,
      403,
      "capability_above_authority",
    );
  }

  // The owner signs the envelope, which is what actually creates the record.
  if (!env.signature) {
    throw new AgentEnvelopeError("registration needs an owner signature", 401, "owner_signature_required");
  }
  if (!env.nonce || env.signedAt === undefined) {
    throw new AgentEnvelopeError("registration needs a nonce and signedAt", 400, "missing_nonce");
  }
  const ownerOk = await verifyAgentSignature({
    address: ownerWallet,
    message: agentRequestMessage(env),
    signature: env.signature,
  });
  if (!ownerOk) {
    throw new AgentEnvelopeError("owner signature does not match", 401, "bad_signature");
  }

  // And the operator proves it controls itself, so an owner cannot enrol a hot
  // wallet they do not actually hold and strand fees against it.
  const operatorSignature = str(env.body, "operatorSignature");
  const operatorOk = await verifyAgentSignature({
    address: operatorWallet,
    message: operatorProofMessage(env.agentId, operatorWallet),
    signature: operatorSignature,
  });
  if (!operatorOk) {
    throw new AgentEnvelopeError("operator proof does not match", 401, "bad_operator_proof");
  }

  const replay = await replayOrConsumeNonce(env, env.nonce);
  if (replay) return replay;

  if (await getAgent(env.agentId)) {
    throw new AgentEnvelopeError("that agent id is taken", 409, "agent_exists");
  }

  const agent = await createAgent({
    agentId: env.agentId,
    ownerWallet,
    operatorWallet,
    payoutWallet,
    displayName: str(env.body, "displayName") || env.agentId,
    authorityLevel: authorityLevel as AuthorityLevel,
    capabilities,
  });

  await recordRequest(env.agentId, "register", true, null).catch(() => undefined);
  return { status: 201, body: { ok: true, agent: publicView(agent) } };
}

// ── everything else ─────────────────────────────────────────────────────────

async function handleAuthenticated(env: AgentEnvelope, authorization: string | null): Promise<Handled> {
  const { agent, credential, nonce } = await authenticateAgentRequest(env, authorization);
  const replay = await replayOrConsumeNonce(env, nonce);
  if (replay) return replay;

  const used = await requestsLastHour(agent.agentId).catch(() => 0);
  const decision = authorizeAction({ agent, action: env.action, requestsLastHour: used });
  if (!decision.allowed) {
    await recordRequest(agent.agentId, env.action, false, decision.reason ?? null).catch(() => undefined);
    return {
      status: decision.reason === "rate_limit" ? 429 : 403,
      body: { ok: false, reason: decision.reason, message: decision.message },
    };
  }

  await recordRequest(agent.agentId, env.action, true, null).catch(() => undefined);

  switch (env.action) {
    case "heartbeat": {
      await touchAgent(agent.agentId).catch(() => undefined);
      return {
        status: 200,
        body: { ok: true, agent: publicView(agent), credential, usage: { requestsLastHour: used } },
      };
    }

    case "dryRun": {
      const result = await dryRun({
        agent,
        action: str(env.body, "action") || "stake",
        stakeUsdc: Number(env.body.stakeUsdc ?? 0) || 0,
        expectedPayoutUsdc: Number(env.body.expectedPayoutUsdc ?? 0) || 0,
      });
      return { status: 200, body: { ok: true, ...result } };
    }

    case "rotateOperator": {
      const next = normalizeAddress(env.body.operatorWallet);
      if (!next) throw new AgentEnvelopeError("operatorWallet must be an address", 400, "bad_wallets");
      const proofOk = await verifyAgentSignature({
        address: next,
        message: operatorProofMessage(agent.agentId, next),
        signature: str(env.body, "operatorSignature"),
      });
      if (!proofOk) {
        throw new AgentEnvelopeError("operator proof does not match", 401, "bad_operator_proof");
      }
      await rotateOperator(agent.agentId, next);
      // A rotation is what you do when the old key leaked, so the keys it could
      // have issued go with it.
      await revokeAllApiKeys(agent.agentId);
      return { status: 200, body: { ok: true, operatorWallet: next, keysRevoked: true } };
    }

    case "issueKey": {
      const key = generateApiKey();
      await insertApiKey({
        keyHash: hashApiKey(key),
        agentId: agent.agentId,
        keyPrefix: apiKeyPrefix(key),
        label: str(env.body, "label") || "default",
        createdAt: Date.now(),
      });
      // Shown once. Only the SHA-256 is kept (the replay table stores a redacted
      // copy), so this cannot be re-read later.
      return { status: 201, body: { ok: true, key, prefix: apiKeyPrefix(key) } };
    }

    case "listKeys": {
      const keys = await listApiKeys(agent.agentId);
      return {
        status: 200,
        body: {
          ok: true,
          keys: keys.map((k) => ({
            prefix: k.keyPrefix,
            label: k.label,
            createdAt: k.createdAt,
            revokedAt: k.revokedAt,
          })),
        },
      };
    }

    case "revokeKey": {
      const prefix = str(env.body, "prefix");
      if (!prefix) throw new AgentEnvelopeError("prefix is required", 400, "missing_prefix");
      const revoked = await revokeApiKey(agent.agentId, prefix);
      if (revoked === 0) throw new AgentEnvelopeError("no such active key", 404, "unknown_key");
      return { status: 200, body: { ok: true, revoked } };
    }

    case "revoke": {
      await setAgentStatus(agent.agentId, "revoked");
      await revokeAllApiKeys(agent.agentId);
      // Terminal on purpose: re-registering is a new record with a new history.
      return { status: 200, body: { ok: true, status: "revoked" } };
    }

    case "listPositions": {
      const created = await getClaimsByFilter({ creator: agent.operatorWallet }).catch(() => []);
      const challenged = await getClaimsByChallenger(agent.operatorWallet).catch(() => []);
      return {
        status: 200,
        body: {
          ok: true,
          operatorWallet: agent.operatorWallet,
          created: created.map((c) => ({ id: c.id, state: c.state, deadline: c.deadline })),
          challenged,
        },
      };
    }

    case "listEarnings": {
      const summary = await getX402RevenueSummary(200).catch(() => null);
      const payout = agent.payoutWallet.toLowerCase();
      const seller = summary?.bySeller.find((s) => s.seller.toLowerCase() === payout) ?? null;
      return {
        status: 200,
        body: {
          ok: true,
          payoutWallet: agent.payoutWallet,
          x402: { calls: seller?.calls ?? 0, usd: seller?.usd ?? 0 },
          // On-chain owner fees land in the contract's accrued balance and are
          // pulled with claimFees(); they are not held or tracked off chain.
          ownerFees: { source: "contract", method: "claimFees()" },
        },
      };
    }

    default:
      throw new AgentEnvelopeError(`${env.action} is not implemented`, 404, "unknown_action");
  }
}

function publicView(agent: AgentRecord) {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    ownerWallet: agent.ownerWallet,
    operatorWallet: agent.operatorWallet,
    payoutWallet: agent.payoutWallet,
    authorityLevel: agent.authorityLevel,
    capabilities: agent.capabilities,
    status: agent.status,
    limits: agent.limits,
    createdAt: agent.createdAt,
    lastSeenAt: agent.lastSeenAt,
  };
}
