import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateCopy,
  validateCopyPermission,
  copyPermissionMessage,
  worstCaseCopySpend,
  InvalidCopyPermissionError,
  COPY_SKIP_REASONS,
  MAX_SIGNAL_AGE_MS,
  type CopyPermission,
  type CopySignal,
  type CopyUsage,
} from "../../lib/copy-trading";

const NOW = 1_700_000_000_000;

function permission(over: Partial<CopyPermission> = {}): CopyPermission {
  return {
    id: "perm-1",
    follower: "0x1111111111111111111111111111111111111111",
    signalAgentId: "statistician",
    executionAgentId: "my-agent",
    active: true,
    expiresAt: NOW + 7 * 24 * 3600 * 1000,
    maxPerPositionUsdc: 2,
    maxDailyUsdc: 10,
    maxWeeklyUsdc: 40,
    maxOpenExposureUsdc: 20,
    maxRealizedLossUsdc: 15,
    allowedCategories: [],
    allowedModes: [],
    minClaimQuality: 70,
    minPayoutRatio: 1.2,
    signature: "0xabc",
    createdAt: NOW,
    ...over,
  };
}

function signal(over: Partial<CopySignal> = {}): CopySignal {
  return {
    signalAgentId: "statistician",
    claimId: 42,
    category: "crypto",
    oddsMode: "pool",
    stakeUsdc: 5,
    claimQuality: 85,
    payoutRatio: 1.9,
    placedAt: NOW - 1000,
    ...over,
  };
}

function usage(over: Partial<CopyUsage> = {}): CopyUsage {
  return {
    spentTodayUsdc: 0,
    spentThisWeekUsdc: 0,
    openExposureUsdc: 0,
    realizedLossUsdc: 0,
    heldClaimIds: [],
    ...over,
  };
}

const run = (over: {
  permission?: Partial<CopyPermission>;
  signal?: Partial<CopySignal>;
  usage?: Partial<CopyUsage>;
  globallyPaused?: boolean;
} = {}) =>
  evaluateCopy({
    permission: permission(over.permission),
    signal: signal(over.signal),
    usage: usage(over.usage),
    now: NOW,
    globallyPaused: over.globallyPaused,
  });

test("a clean signal is copied, sized down to the per-position cap", () => {
  const d = run();
  assert.equal(d.allowed, true);
  assert.equal(d.stakeUsdc, 2, "a 5 USDC signal under a 2 USDC ceiling copies at 2");
});

test("the gate is deterministic", () => {
  const first = run({ usage: { spentTodayUsdc: 10 } });
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(run({ usage: { spentTodayUsdc: 10 } }), first);
  }
});

test("a global pause beats every other consideration", () => {
  assert.equal(run({ globallyPaused: true }).reason, "globally_paused");
});

test("an inactive or expired permission never executes", () => {
  assert.equal(run({ permission: { active: false } }).reason, "permission_inactive");
  assert.equal(run({ permission: { expiresAt: NOW - 1 } }).reason, "permission_expired");
  assert.equal(run({ permission: { expiresAt: NOW } }).reason, "permission_expired", "expiry is inclusive");
});

test("an agent cannot copy itself", () => {
  assert.equal(run({ permission: { executionAgentId: "statistician" } }).reason, "self_copy");
});

test("copy depth is 1 and cycles are refused", () => {
  assert.equal(run({ signal: { ancestry: ["someone-else"] } }).reason, "depth_exceeded");
  assert.equal(run({ signal: { ancestry: [] } }).allowed, true);
  assert.equal(
    evaluateCopy({
      permission: permission({ maxPerPositionUsdc: 2 }),
      signal: signal({ ancestry: ["my-agent"] }),
      usage: usage(),
      now: NOW,
    }).reason,
    "depth_exceeded",
    "an ancestry that long fails on depth before the cycle check is reached",
  );
});

test("a position already held is not duplicated", () => {
  assert.equal(run({ usage: { heldClaimIds: [42] } }).reason, "duplicate_position");
  assert.equal(run({ usage: { heldClaimIds: [41, 43] } }).allowed, true);
});

test("a stale signal is refused at the boundary", () => {
  assert.equal(run({ signal: { placedAt: NOW - MAX_SIGNAL_AGE_MS } }).allowed, true);
  assert.equal(run({ signal: { placedAt: NOW - MAX_SIGNAL_AGE_MS - 1 } }).reason, "stale_signal");
});

test("empty allowlists mean everything is allowed", () => {
  assert.equal(run({ signal: { category: "weather", oddsMode: "fixed" } }).allowed, true);
});

test("a populated allowlist excludes everything else", () => {
  assert.equal(
    run({ permission: { allowedCategories: ["sports"] }, signal: { category: "crypto" } }).reason,
    "category_not_allowed",
  );
  assert.equal(
    run({ permission: { allowedModes: ["pool"] }, signal: { oddsMode: "fixed" } }).reason,
    "mode_not_allowed",
  );
  assert.equal(
    run({ permission: { allowedCategories: ["crypto"], allowedModes: ["pool"] } }).allowed,
    true,
  );
});

test("claim-quality and payout floors are enforced at the boundary", () => {
  assert.equal(run({ signal: { claimQuality: 70 } }).allowed, true);
  assert.equal(run({ signal: { claimQuality: 69 } }).reason, "quality_below_floor");
  assert.equal(run({ signal: { payoutRatio: 1.2 } }).allowed, true);
  assert.equal(run({ signal: { payoutRatio: 1.19 } }).reason, "payout_below_floor");
});

test("the realized-loss ceiling stops copying for good", () => {
  assert.equal(run({ usage: { realizedLossUsdc: 15 } }).reason, "realized_loss_limit");
  assert.equal(run({ usage: { realizedLossUsdc: 14.99 } }).allowed, true);
});

test("a spent cap is named rather than silently sizing to zero", () => {
  assert.equal(run({ usage: { spentTodayUsdc: 10 } }).reason, "daily_cap");
  assert.equal(run({ usage: { spentThisWeekUsdc: 40 } }).reason, "weekly_cap");
  assert.equal(run({ usage: { openExposureUsdc: 20 } }).reason, "exposure_cap");
});

test("a partially spent cap sizes the copy down instead of refusing it", () => {
  const d = run({ usage: { spentTodayUsdc: 9 } });
  assert.equal(d.allowed, true);
  assert.equal(d.stakeUsdc, 1, "only 1 USDC of the daily cap is left");
});

test("the smallest binding cap wins", () => {
  const d = run({
    permission: { maxPerPositionUsdc: 5 },
    usage: { spentTodayUsdc: 8, spentThisWeekUsdc: 39.5, openExposureUsdc: 19.75 },
  });
  assert.equal(d.allowed, true);
  assert.equal(d.stakeUsdc, 0.25, "exposure headroom is the tightest of the three");
});

test("stake is rounded down to cents, never up", () => {
  const d = run({ permission: { maxPerPositionUsdc: 1.239 } });
  assert.equal(d.stakeUsdc, 1.23);
});

test("a refused copy always stakes zero", () => {
  for (const d of [
    run({ globallyPaused: true }),
    run({ permission: { active: false } }),
    run({ usage: { heldClaimIds: [42] } }),
  ]) {
    assert.equal(d.allowed, false);
    assert.equal(d.stakeUsdc, 0);
  }
});

test("every skip reason the gate can return is in the published enum", () => {
  const reasons = new Set<string>(COPY_SKIP_REASONS);
  for (const d of [
    run({ globallyPaused: true }),
    run({ permission: { active: false } }),
    run({ permission: { expiresAt: NOW - 1 } }),
    run({ permission: { executionAgentId: "statistician" } }),
    run({ signal: { ancestry: ["x"] } }),
    run({ usage: { heldClaimIds: [42] } }),
    run({ signal: { placedAt: 0 } }),
    run({ permission: { allowedCategories: ["sports"] } }),
    run({ permission: { allowedModes: ["fixed"] }, signal: { oddsMode: "pool" } }),
    run({ signal: { claimQuality: 1 } }),
    run({ signal: { payoutRatio: 1 } }),
    run({ usage: { realizedLossUsdc: 99 } }),
    run({ usage: { spentTodayUsdc: 99 } }),
    run({ usage: { spentThisWeekUsdc: 99 } }),
    run({ usage: { openExposureUsdc: 99 } }),
  ]) {
    assert.equal(d.allowed, false);
    assert.ok(reasons.has(d.reason!), `${d.reason} is not in COPY_SKIP_REASONS`);
  }
});

test("a permission must be internally coherent", () => {
  assert.doesNotThrow(() => validateCopyPermission(permission(), NOW));
  const bad: Array<Partial<CopyPermission>> = [
    { executionAgentId: "statistician" },
    { expiresAt: NOW - 1 },
    { maxPerPositionUsdc: 0 },
    { maxPerPositionUsdc: 11 }, // above the daily cap
    { maxDailyUsdc: 50 }, // above the weekly cap
    { minClaimQuality: 101 },
    { minPayoutRatio: 0.9 },
  ];
  for (const over of bad) {
    assert.throws(
      () => validateCopyPermission(permission(over), NOW),
      InvalidCopyPermissionError,
      JSON.stringify(over),
    );
  }
});

test("worst-case spend is bounded by the weekly cap", () => {
  assert.equal(worstCaseCopySpend(permission()), 35);
  assert.equal(worstCaseCopySpend(permission({ maxWeeklyUsdc: 10 })), 10);
});

test("the signed message spells out every bound", () => {
  const p = permission({ allowedCategories: ["crypto"], allowedModes: ["pool"] });
  const message = copyPermissionMessage(p);
  for (const fragment of [
    "copy: statistician",
    "executed by: my-agent",
    "per position: 2 USDC",
    "per day: 10 USDC",
    "per week: 40 USDC",
    "open exposure: 20 USDC",
    "stop after losing: 15 USDC",
    "min claim quality: 70/100",
    "min payout: 1.2x",
    "categories: crypto",
    "modes: pool",
    "Nothing is deposited",
  ]) {
    assert.ok(message.includes(fragment), `missing: ${fragment}`);
  }
  assert.match(copyPermissionMessage(permission()), /categories: any/);
});
