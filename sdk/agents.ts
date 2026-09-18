/**
 * Mimir agent SDK.
 *
 * Wraps the signed envelope so an agent author writes `client.heartbeat()`
 * rather than re-deriving a keccak256 body hash by hand. The signing function
 * is injected: Mimir never sees a key, and this file never asks for one.
 *
 * ```ts
 * import { privateKeyToAccount } from "viem/accounts";
 * import { MimirAgentClient } from "mimir/sdk/agents";
 *
 * const operator = privateKeyToAccount(process.env.OPERATOR_KEY as `0x${string}`);
 * const client = new MimirAgentClient({
 *   baseUrl: "https://mimir.example",
 *   agentId: "my-agent",
 *   apiKey: process.env.MIMIR_AGENT_KEY,
 *   signMessage: (message) => operator.signMessage({ message }),
 * });
 * await client.heartbeat();
 * ```
 */
import {
  agentRequestMessage,
  operatorProofMessage,
  type AgentAction,
  type AgentEnvelope,
} from "@/lib/agents/api";

export type SignMessage = (message: string) => Promise<string>;

export interface MimirAgentClientOptions {
  baseUrl: string;
  agentId: string;
  /** Bearer key for day-to-day calls. Owner-gated actions always need a signature. */
  apiKey?: string;
  /** Signs owner-gated actions, and any call made without an API key. */
  signMessage?: SignMessage;
  fetchImpl?: typeof fetch;
}

export class MimirAgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(message);
  }
}

function randomId(): string {
  // Avoids a uuid dependency; collision risk here only costs an idempotent replay.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export class MimirAgentClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly apiKey?: string;
  private readonly signMessage?: SignMessage;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MimirAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.signMessage = options.signMessage;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Send one action.
   *
   * `sign: true` produces a signature even when an API key is present, which is
   * what owner-gated actions need. Retries are safe: the same idempotency key
   * returns the stored response instead of executing twice.
   */
  async call<T = unknown>(
    action: AgentAction,
    body: Record<string, unknown> = {},
    { sign = false }: { sign?: boolean } = {},
  ): Promise<T> {
    const envelope: AgentEnvelope = {
      version: "v1",
      agentId: this.agentId,
      action,
      idempotencyKey: randomId(),
      nonce: randomId(),
      signedAt: Date.now(),
      body,
    };

    const mustSign = sign || !this.apiKey;
    if (mustSign) {
      if (!this.signMessage) {
        throw new Error(`${action} needs a signature, but no signMessage was provided`);
      }
      envelope.signature = await this.signMessage(agentRequestMessage(envelope));
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/api/agents/v1/${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });

    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new MimirAgentApiError(
        String(parsed.message ?? `HTTP ${res.status}`),
        res.status,
        String(parsed.reason ?? "unknown"),
      );
    }
    return parsed as T;
  }

  heartbeat(status = "ok") {
    return this.call("heartbeat", { status });
  }

  /** Simulate a funded action: policy decision, fee split and remaining budget. */
  dryRun(input: { action: string; stakeUsdc?: number; expectedPayoutUsdc?: number }) {
    return this.call("dryRun", input as Record<string, unknown>);
  }

  listPositions() {
    return this.call("listPositions");
  }

  listEarnings() {
    return this.call("listEarnings");
  }

  /** Owner-signed. The returned key is shown once and cannot be read back. */
  issueKey(label = "default") {
    return this.call<{ key: string; prefix: string }>("issueKey", { label }, { sign: true });
  }

  listKeys() {
    return this.call("listKeys", {}, { sign: true });
  }

  revokeKey(prefix: string) {
    return this.call("revokeKey", { prefix }, { sign: true });
  }

  /** Owner-signed and terminal. Clears capabilities and every issued key. */
  revoke() {
    return this.call("revoke", {}, { sign: true });
  }

  rotateOperator(operatorWallet: string, operatorSignature: string) {
    return this.call("rotateOperator", { operatorWallet, operatorSignature }, { sign: true });
  }
}

/** The message a new operator wallet signs to prove it controls itself. */
export { operatorProofMessage };

/**
 * Register a new agent. Separate from the client because there is no agent to
 * construct a client around yet, and because it needs two signatures: the owner
 * authorizes the record, the operator proves it holds its own key.
 */
export async function registerAgent(args: {
  baseUrl: string;
  agentId: string;
  ownerWallet: string;
  operatorWallet: string;
  payoutWallet?: string;
  displayName?: string;
  authorityLevel?: number;
  capabilities?: string[];
  signWithOwner: SignMessage;
  signWithOperator: SignMessage;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const doFetch = args.fetchImpl ?? fetch;
  const operatorSignature = await args.signWithOperator(
    operatorProofMessage(args.agentId, args.operatorWallet),
  );

  const envelope: AgentEnvelope = {
    version: "v1",
    agentId: args.agentId,
    action: "register",
    idempotencyKey: randomId(),
    nonce: randomId(),
    signedAt: Date.now(),
    body: {
      ownerWallet: args.ownerWallet,
      operatorWallet: args.operatorWallet,
      payoutWallet: args.payoutWallet ?? args.ownerWallet,
      displayName: args.displayName ?? args.agentId,
      authorityLevel: args.authorityLevel ?? 0,
      capabilities: args.capabilities ?? [],
      operatorSignature,
    },
  };
  envelope.signature = await args.signWithOwner(agentRequestMessage(envelope));

  const res = await doFetch(`${args.baseUrl.replace(/\/+$/, "")}/api/agents/v1/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new MimirAgentApiError(
      String(parsed.message ?? `HTTP ${res.status}`),
      res.status,
      String(parsed.reason ?? "unknown"),
    );
  }
  return parsed;
}
