import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeAction,
  defaultLimits,
  grantableCapabilities,
  isAuthorityLevel,
  isCapability,
  AUTHORITY_LEVELS,
  AGENT_CAPABILITIES,
  CAPABILITY_MIN_AUTHORITY,
  type AgentRecord,
} from "../../lib/agents/registry";

function agent(over: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "my-agent",
    ownerWallet: "0x1111111111111111111111111111111111111111",
    operatorWallet: "0x2222222222222222222222222222222222222222",
    payoutWallet: "0x1111111111111111111111111111111111111111",
    displayName: "My Agent",
    authorityLevel: AUTHORITY_LEVELS.STAKE,
    capabilities: ["council_juror", "researcher"],
    status: "active",
    limits: defaultLimits(),
    createdAt: 0,
    updatedAt: 0,
    lastSeenAt: null,
    ...over,
  };
}

test("a fresh agent gets the documented ceilings", () => {
  assert.deepEqual(defaultLimits(), {
    requestsPerHour: 120,
    maxActiveMarkets: 3,
    maxDailyUsdc: 20,
    maxPositionUsdc: 5,
  });
});

test("status gates everything before any other check", () => {
  for (const status of ["revoked", "paused", "pending"] as const) {
    const d = authorizeAction({ agent: agent({ status }), action: "heartbeat" });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, status);
  }
  assert.equal(authorizeAction({ agent: agent(), action: "heartbeat" }).allowed, true);
});

test("an action below the agent's authority is refused by name", () => {
  const readOnly = agent({ authorityLevel: AUTHORITY_LEVELS.READ_ONLY, capabilities: ["market_creator"] });
  const d = authorizeAction({ agent: readOnly, action: "stake" });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "authority");
  assert.equal(authorizeAction({ agent: readOnly, action: "heartbeat" }).allowed, true);
});

test("a missing capability is refused even at sufficient authority", () => {
  const noCapability = agent({ authorityLevel: AUTHORITY_LEVELS.MONETISE, capabilities: [] });
  const d = authorizeAction({ agent: noCapability, action: "createMarket" });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "capability");

  const withCapability = agent({
    authorityLevel: AUTHORITY_LEVELS.MONETISE,
    capabilities: ["market_creator"],
  });
  assert.equal(authorizeAction({ agent: withCapability, action: "createMarket" }).allowed, true);
});

test("the rate limit fires at the ceiling, not past it", () => {
  const a = agent();
  assert.equal(authorizeAction({ agent: a, action: "heartbeat", requestsLastHour: 119 }).allowed, true);
  const d = authorizeAction({ agent: a, action: "heartbeat", requestsLastHour: 120 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "rate_limit");
});

test("a position above the per-position cap is refused before the daily cap is consulted", () => {
  const d = authorizeAction({ agent: agent(), action: "stake", positionUsdc: 6 });
  assert.equal(d.reason, "position_cap");
});

test("the daily cap counts what is already at risk", () => {
  const a = agent();
  assert.equal(authorizeAction({ agent: a, action: "stake", positionUsdc: 5, spentTodayUsdc: 15 }).allowed, true);
  const d = authorizeAction({ agent: a, action: "stake", positionUsdc: 5, spentTodayUsdc: 16 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "daily_cap");
});

test("the active-market cap only applies to creating markets", () => {
  const a = agent({ authorityLevel: AUTHORITY_LEVELS.MONETISE, capabilities: ["market_creator"] });
  const d = authorizeAction({ agent: a, action: "createMarket", activeMarkets: 3 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "active_markets");
  assert.equal(authorizeAction({ agent: a, action: "heartbeat", activeMarkets: 99 }).allowed, true);
});

test("the gate is deterministic: the same input always gives the same answer", () => {
  const input = { agent: agent(), action: "stake", positionUsdc: 6, requestsLastHour: 200 } as const;
  const first = authorizeAction(input);
  for (let i = 0; i < 5; i++) assert.deepEqual(authorizeAction(input), first);
  assert.equal(first.reason, "rate_limit", "the earlier check in the order wins");
});

test("reputation cannot escalate authority: capabilities are bounded by level", () => {
  assert.deepEqual(grantableCapabilities(AUTHORITY_LEVELS.READ_ONLY), ["researcher"]);
  const monetise = grantableCapabilities(AUTHORITY_LEVELS.MONETISE);
  for (const c of AGENT_CAPABILITIES) assert.ok(monetise.includes(c), c);
  for (const c of AGENT_CAPABILITIES) {
    const level = CAPABILITY_MIN_AUTHORITY[c];
    if (level > 0) {
      assert.equal(
        grantableCapabilities((level - 1) as never).includes(c),
        false,
        `${c} must not be grantable one level below its minimum`,
      );
    }
  }
});

test("capability and authority guards reject junk", () => {
  assert.equal(isCapability("council_juror"), true);
  assert.equal(isCapability("admin"), false);
  assert.equal(isAuthorityLevel(0), true);
  assert.equal(isAuthorityLevel(4), true);
  assert.equal(isAuthorityLevel(5), false);
  assert.equal(isAuthorityLevel(-1), false);
  assert.equal(isAuthorityLevel(2.5), false);
  assert.equal(isAuthorityLevel("3"), false);
});
