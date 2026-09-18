import "server-only";

/**
 * Who is calling, and may they.
 *
 * Two credentials exist. A bearer API key identifies the agent for day-to-day
 * calls and lets the server fill in the nonce and timestamp itself. Owner-gated
 * actions ignore keys entirely and demand a real signature from the owner
 * wallet, so a stolen hot key cannot issue itself new keys, rotate the operator
 * or move the payout address.
 */
import {
  agentRequestMessage,
  AgentEnvelopeError,
  OWNER_SIGNED_ACTIONS,
  type AgentAction,
  type AgentEnvelope,
} from "./api";
import { hashApiKey, parseApiKeyHeader } from "./api-keys";
import { verifyAgentSignature } from "./signature";
import { agentIdForKeyHash, consumeNonce, getAgent } from "./store";
import type { AgentRecord } from "./registry";

export type Credential = "owner_signature" | "operator_signature" | "api_key";

export interface Authenticated {
  agent: AgentRecord;
  credential: Credential;
}

export function requiresOwnerSignature(action: AgentAction): boolean {
  return OWNER_SIGNED_ACTIONS.includes(action);
}

/**
 * Authenticate an envelope for an agent that already exists.
 *
 * `register` is not handled here: there is no record to authenticate against
 * yet, so the route verifies the owner and operator signatures itself.
 */
export async function authenticateAgentRequest(
  env: AgentEnvelope,
  authorizationHeader: string | null,
): Promise<Authenticated> {
  const agent = await getAgent(env.agentId);
  if (!agent) {
    throw new AgentEnvelopeError("unknown agent", 404, "unknown_agent");
  }
  if (agent.status === "revoked") {
    throw new AgentEnvelopeError("this agent has been revoked", 403, "revoked");
  }

  const ownerGated = requiresOwnerSignature(env.action);

  if (ownerGated) {
    if (!env.signature) {
      throw new AgentEnvelopeError(
        `${env.action} requires an owner signature, not an API key`,
        401,
        "owner_signature_required",
      );
    }
    await assertFreshSignature(env, agent.ownerWallet, agent.agentId);
    return { agent, credential: "owner_signature" };
  }

  const key = parseApiKeyHeader(authorizationHeader);
  if (key) {
    const owner = await agentIdForKeyHash(hashApiKey(key));
    if (owner !== agent.agentId) {
      throw new AgentEnvelopeError("invalid API key", 401, "bad_api_key");
    }
    return { agent, credential: "api_key" };
  }

  if (!env.signature) {
    throw new AgentEnvelopeError("no credential presented", 401, "no_credential");
  }
  await assertFreshSignature(env, agent.operatorWallet, agent.agentId);
  return { agent, credential: "operator_signature" };
}

/**
 * Verify the signature and burn the nonce.
 *
 * The nonce is consumed only after the signature checks out, so an attacker
 * cannot invalidate a legitimate caller's nonce by replaying it with garbage.
 */
export async function assertFreshSignature(
  env: AgentEnvelope,
  expectedSigner: string,
  agentId: string,
): Promise<void> {
  if (!env.nonce) {
    throw new AgentEnvelopeError("a signed request needs a nonce", 400, "missing_nonce");
  }
  if (env.signedAt === undefined) {
    throw new AgentEnvelopeError("a signed request needs signedAt", 400, "missing_signed_at");
  }
  const ok = await verifyAgentSignature({
    address: expectedSigner,
    message: agentRequestMessage(env),
    signature: env.signature ?? "",
  });
  if (!ok) {
    throw new AgentEnvelopeError("signature does not match", 401, "bad_signature");
  }
  if (!(await consumeNonce(agentId, env.nonce))) {
    throw new AgentEnvelopeError("nonce already used", 409, "nonce_replay");
  }
}
