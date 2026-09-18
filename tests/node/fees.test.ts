import test from "node:test";
import assert from "node:assert/strict";

import {
  splitFees,
  validateFeePolicy,
  noWinnerLosesPrincipal,
  conservationHolds,
  formatUsdc,
  InvalidFeePolicyError,
  DEFAULT_FEE_POLICY,
  MAX_TOTAL_FEE_BPS,
  ONE_USDC,
  type FeePolicy,
} from "../../lib/fees";

const PLATFORM = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const WINNER = "0x3333333333333333333333333333333333333333";

const policy: FeePolicy = { ...DEFAULT_FEE_POLICY, platformRecipient: PLATFORM };

test("fees are charged on profit, never on principal", () => {
  // Stake 10, win 11 back: 1 USDC of profit is the only fee base.
  const split = splitFees({
    gross: 11n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: WINNER,
    agentOwner: AGENT,
  });
  assert.equal(split.profit, ONE_USDC);
  assert.equal(split.platformFee, ONE_USDC / 200n); // 50 bps
  assert.equal(split.agentOwnerFee, ONE_USDC / 200n);
  assert.equal(split.netPayout, 11n * ONE_USDC - ONE_USDC / 100n);
  assert.equal(noWinnerLosesPrincipal(split, 10n * ONE_USDC), true);
  assert.equal(conservationHolds(split, 11n * ONE_USDC), true);
});

test("a refund is free", () => {
  const split = splitFees({
    gross: 10n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: WINNER,
    agentOwner: AGENT,
  });
  assert.equal(split.profit, 0n);
  assert.equal(split.totalFees, 0n);
  assert.equal(split.netPayout, 10n * ONE_USDC);
});

test("a gross below principal cannot produce a negative fee base", () => {
  const split = splitFees({
    gross: 9n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: WINNER,
  });
  assert.equal(split.profit, 0n);
  assert.equal(split.totalFees, 0n);
});

test("no agent attribution means no agent leg", () => {
  const split = splitFees({
    gross: 11n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: WINNER,
    agentOwner: null,
  });
  assert.equal(split.agentOwnerFee, 0n);
  assert.equal(split.totalFees, ONE_USDC / 200n);
});

test("nobody pays themselves", () => {
  const throughOwnAgent = splitFees({
    gross: 11n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: AGENT,
    agentOwner: AGENT,
  });
  assert.equal(throughOwnAgent.agentOwnerFee, 0n);

  const platformIsWinner = splitFees({
    gross: 11n * ONE_USDC,
    principal: 10n * ONE_USDC,
    policy,
    winner: PLATFORM.toUpperCase(),
    agentOwner: AGENT,
  });
  assert.equal(platformIsWinner.platformFee, 0n, "address comparison must ignore case");
  assert.equal(platformIsWinner.agentOwnerFee, ONE_USDC / 200n);
});

test("rounding favours the participant and never creates money", () => {
  // 7 wei of profit at 50 bps rounds down to zero rather than up.
  const split = splitFees({
    gross: 10n * ONE_USDC + 7n,
    principal: 10n * ONE_USDC,
    policy,
    winner: WINNER,
    agentOwner: AGENT,
  });
  assert.equal(split.profit, 7n);
  assert.equal(split.totalFees, 0n);
  assert.equal(conservationHolds(split, 10n * ONE_USDC + 7n), true);
});

test("a winner never receives less than their principal, across the whole fee range", () => {
  for (let bps = 0; bps <= MAX_TOTAL_FEE_BPS; bps += 25) {
    const p: FeePolicy = {
      platformFeeBps: bps,
      agentOwnerFeeBps: 0,
      platformRecipient: PLATFORM,
    };
    for (const profit of [1n, 1000n, ONE_USDC, 1234n * ONE_USDC]) {
      const principal = 10n * ONE_USDC;
      const split = splitFees({ gross: principal + profit, principal, policy: p, winner: WINNER });
      assert.equal(noWinnerLosesPrincipal(split, principal), true, `bps=${bps} profit=${profit}`);
      assert.equal(conservationHolds(split, principal + profit), true);
    }
  }
});

test("the fee cap and recipient rule are enforced", () => {
  assert.throws(
    () => validateFeePolicy({ platformFeeBps: 900, agentOwnerFeeBps: 200, platformRecipient: PLATFORM }),
    InvalidFeePolicyError,
  );
  assert.throws(
    () => validateFeePolicy({ platformFeeBps: 50, agentOwnerFeeBps: 50, platformRecipient: null }),
    InvalidFeePolicyError,
  );
  assert.throws(
    () => validateFeePolicy({ platformFeeBps: -1, agentOwnerFeeBps: 0, platformRecipient: PLATFORM }),
    InvalidFeePolicyError,
  );
  // An agent-only policy needs no platform recipient.
  assert.doesNotThrow(() =>
    validateFeePolicy({ platformFeeBps: 0, agentOwnerFeeBps: 50, platformRecipient: null }),
  );
});

test("formatUsdc renders 18-decimal atomic amounts", () => {
  assert.equal(formatUsdc(0n), "0");
  assert.equal(formatUsdc(ONE_USDC), "1");
  assert.equal(formatUsdc(ONE_USDC / 200n), "0.005");
  assert.equal(formatUsdc(10n * ONE_USDC + ONE_USDC / 2n), "10.5");
  assert.equal(formatUsdc(-ONE_USDC), "-1");
});
