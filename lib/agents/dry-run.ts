import "server-only";

/**
 * Simulate a funded action without moving anything.
 *
 * The point is that a misconfigured agent fails cheap: it learns the policy
 * decision, the exact fee split it would pay and how much of its budget is
 * left before it signs a transaction, not after.
 */
import { splitFees, ONE_USDC, DEFAULT_FEE_POLICY, type FeePolicy } from "@/lib/fees";

import { authorizeAction, type AgentRecord } from "./registry";
import { requestsLastHour } from "./store";

export interface DryRunInput {
  agent: AgentRecord;
  action: string;
  /** USDC this call would stake. */
  stakeUsdc?: number;
  /** Payout the agent expects if it wins, USDC. Used to quote the fee split. */
  expectedPayoutUsdc?: number;
}

export interface DryRunResult {
  action: string;
  allowed: boolean;
  reason?: string;
  message?: string;
  limits: AgentRecord["limits"];
  usage: { requestsLastHour: number };
  feeQuote: {
    policy: FeePolicy;
    profitUsdc: string;
    platformFeeUsdc: string;
    agentOwnerFeeUsdc: string;
    netPayoutUsdc: string;
  } | null;
}

function toAtomic(usdc: number): bigint {
  // Round to 6 decimals before scaling: floats past that are noise, not money.
  return (BigInt(Math.round(usdc * 1e6)) * ONE_USDC) / 1_000_000n;
}

function toUsdcString(atomic: bigint): string {
  const scaled = (atomic * 1_000_000n) / ONE_USDC;
  return (Number(scaled) / 1e6).toFixed(6);
}

export function platformFeePolicy(): FeePolicy {
  const recipient = process.env.PLATFORM_FEE_RECIPIENT?.toLowerCase() ?? null;
  return {
    ...DEFAULT_FEE_POLICY,
    platformFeeBps: recipient ? DEFAULT_FEE_POLICY.platformFeeBps : 0,
    platformRecipient: recipient,
  };
}

export async function dryRun(input: DryRunInput): Promise<DryRunResult> {
  const { agent, action, stakeUsdc = 0, expectedPayoutUsdc = 0 } = input;
  const used = await requestsLastHour(agent.agentId).catch(() => 0);

  const decision = authorizeAction({
    agent,
    action,
    requestsLastHour: used,
    positionUsdc: stakeUsdc,
  });

  let feeQuote: DryRunResult["feeQuote"] = null;
  if (stakeUsdc > 0 && expectedPayoutUsdc > 0) {
    const policy = platformFeePolicy();
    const split = splitFees({
      gross: toAtomic(expectedPayoutUsdc),
      principal: toAtomic(stakeUsdc),
      policy,
      winner: agent.operatorWallet,
      agentOwner: agent.payoutWallet,
    });
    feeQuote = {
      policy,
      profitUsdc: toUsdcString(split.profit),
      platformFeeUsdc: toUsdcString(split.platformFee),
      agentOwnerFeeUsdc: toUsdcString(split.agentOwnerFee),
      netPayoutUsdc: toUsdcString(split.netPayout),
    };
  }

  return {
    action,
    allowed: decision.allowed,
    reason: decision.reason,
    message: decision.message,
    limits: agent.limits,
    usage: { requestsLastHour: used },
    feeQuote,
  };
}
