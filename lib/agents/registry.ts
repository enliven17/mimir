/**
 * Agent authority model.
 *
 * The invariant that shapes the design: Mimir never holds an external agent's
 * private key. An agent proves who it is by signing, signs its own
 * transactions, and Mimir verifies signatures and enforces limits.
 *
 * Owner, operator and payout are three separate wallets on purpose. The owner
 * is cold and receives fees; the operator is the hot key that signs day to day.
 * A stolen operator key is therefore a rotation, not a loss of the agent, and
 * whoever holds it cannot redirect the revenue: fees always land in the payout
 * wallet recorded here.
 */

export const AUTHORITY_LEVELS = {
  READ_ONLY: 0,
  PROPOSE: 1,
  CREATE: 2,
  STAKE: 3,
  MONETISE: 4,
} as const;

export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[keyof typeof AUTHORITY_LEVELS];

export const MAX_AUTHORITY_LEVEL = AUTHORITY_LEVELS.MONETISE;

/**
 * The highest level an agent can give itself at registration. Up to STAKE the
 * agent only ever risks its own operator's money; MONETISE lists it as a copy
 * source and x402 seller that other people pay and follow, so a registration
 * asking for it is stored as `pending` until an operator activates it.
 */
export const SELF_SERVICE_MAX_AUTHORITY = AUTHORITY_LEVELS.STAKE;

export const AGENT_CAPABILITIES = [
  "market_creator",
  "council_juror",
  "researcher",
  "copy_source",
  "x402_seller",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

/** Minimum authority each capability is meaningless below. */
export const CAPABILITY_MIN_AUTHORITY: Record<AgentCapability, AuthorityLevel> = {
  researcher: AUTHORITY_LEVELS.READ_ONLY,
  market_creator: AUTHORITY_LEVELS.CREATE,
  council_juror: AUTHORITY_LEVELS.STAKE,
  copy_source: AUTHORITY_LEVELS.MONETISE,
  x402_seller: AUTHORITY_LEVELS.MONETISE,
};

export const AGENT_STATUSES = ["pending", "active", "paused", "revoked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentLimits {
  requestsPerHour: number;
  maxActiveMarkets: number;
  maxDailyUsdc: number;
  maxPositionUsdc: number;
}

/**
 * What a fresh agent gets. These are platform ceilings, enforced regardless of
 * what an owner signs: raising them is a deliberate, owner-requested change,
 * not something an agent can grant itself by asking nicely.
 */
export function defaultLimits(): AgentLimits {
  return {
    requestsPerHour: 120,
    maxActiveMarkets: 3,
    maxDailyUsdc: 20,
    maxPositionUsdc: 5,
  };
}

export interface AgentRecord {
  agentId: string;
  ownerWallet: string;
  operatorWallet: string;
  payoutWallet: string;
  displayName: string;
  authorityLevel: AuthorityLevel;
  capabilities: AgentCapability[];
  status: AgentStatus;
  limits: AgentLimits;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

/** Minimum authority an action requires before capabilities are even considered. */
export const ACTION_MIN_AUTHORITY: Record<string, AuthorityLevel> = {
  heartbeat: AUTHORITY_LEVELS.READ_ONLY,
  listPositions: AUTHORITY_LEVELS.READ_ONLY,
  listEarnings: AUTHORITY_LEVELS.READ_ONLY,
  dryRun: AUTHORITY_LEVELS.READ_ONLY,
  proposeMarket: AUTHORITY_LEVELS.PROPOSE,
  createMarket: AUTHORITY_LEVELS.CREATE,
  stake: AUTHORITY_LEVELS.STAKE,
};

export const ACTION_CAPABILITY: Partial<Record<string, AgentCapability>> = {
  createMarket: "market_creator",
  proposeMarket: "market_creator",
};

export interface AuthorizationDecision {
  allowed: boolean;
  /** Machine-readable cause, so a caller can tell a budget from a permission. */
  reason?: string;
  message?: string;
}

const ALLOW: AuthorizationDecision = { allowed: true };

function deny(reason: string, message: string): AuthorizationDecision {
  return { allowed: false, reason, message };
}

export interface AuthorizeInput {
  agent: AgentRecord;
  action: string;
  /** Requests this agent has made in the trailing hour. */
  requestsLastHour?: number;
  /** USDC this agent has put at risk today. */
  spentTodayUsdc?: number;
  /** Markets this agent currently has open. */
  activeMarkets?: number;
  /** USDC this specific call would stake. */
  positionUsdc?: number;
}

/**
 * The single gate every agent call passes through. Checks run in a fixed order
 * and the first failure wins, so the same input always produces the same
 * refusal and an agent operator can tell exactly which bound they hit.
 */
export function authorizeAction({
  agent,
  action,
  requestsLastHour = 0,
  spentTodayUsdc = 0,
  activeMarkets = 0,
  positionUsdc = 0,
}: AuthorizeInput): AuthorizationDecision {
  if (agent.status === "revoked") return deny("revoked", "this agent has been revoked");
  if (agent.status === "paused") return deny("paused", "this agent is paused");
  if (agent.status === "pending") return deny("pending", "this agent is awaiting activation");

  const minAuthority = ACTION_MIN_AUTHORITY[action];
  if (minAuthority !== undefined && agent.authorityLevel < minAuthority) {
    return deny("authority", `${action} needs authority level ${minAuthority}`);
  }

  const capability = ACTION_CAPABILITY[action];
  if (capability && !agent.capabilities.includes(capability)) {
    return deny("capability", `${action} needs the ${capability} capability`);
  }

  if (requestsLastHour >= agent.limits.requestsPerHour) {
    return deny("rate_limit", `over ${agent.limits.requestsPerHour} requests per hour`);
  }

  if (positionUsdc > 0) {
    if (positionUsdc > agent.limits.maxPositionUsdc) {
      return deny("position_cap", `position above ${agent.limits.maxPositionUsdc} USDC`);
    }
    if (spentTodayUsdc + positionUsdc > agent.limits.maxDailyUsdc) {
      return deny("daily_cap", `over ${agent.limits.maxDailyUsdc} USDC at risk today`);
    }
  }

  if (action === "createMarket" && activeMarkets >= agent.limits.maxActiveMarkets) {
    return deny("active_markets", `already at ${agent.limits.maxActiveMarkets} active markets`);
  }

  return ALLOW;
}

export function isCapability(value: unknown): value is AgentCapability {
  return typeof value === "string" && (AGENT_CAPABILITIES as readonly string[]).includes(value);
}

export function isAuthorityLevel(value: unknown): value is AuthorityLevel {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= AUTHORITY_LEVELS.READ_ONLY &&
    value <= MAX_AUTHORITY_LEVEL
  );
}

/**
 * Capabilities a given authority level may hold. Reputation never escalates
 * authority: an explicit owner grant is the only path to spending money.
 */
export function grantableCapabilities(level: AuthorityLevel): AgentCapability[] {
  return AGENT_CAPABILITIES.filter((c) => CAPABILITY_MIN_AUTHORITY[c] <= level);
}
