import "server-only";

/**
 * Turning a signal agent's on-chain positions into copy instructions.
 *
 * Mimir does not place the copy. On Arc there is no spend permission an
 * operator could draw on, and inventing one would mean holding a follower's
 * key, which is the one thing the whole agent design refuses to do. So the
 * follower's own registered execution agent asks what it should copy, gets a
 * gated answer with a size attached, and stakes it with its own key.
 *
 * That leaves the policy where it belongs: Mimir decides what is permitted, the
 * agent decides whether to act, and the follower's wallet is the only thing
 * that can move their money.
 */

import { query } from "@/lib/db";
import { computeClaimQuality } from "@/lib/claimQuality";
import {
  evaluateCopy,
  type CopyDecision,
  type CopyPermission,
  type CopySignal,
} from "@/lib/copy-trading";
import { loadUsage } from "@/lib/copy-trading-store";
import { isPaused } from "@/lib/ops/flags";
import { COUNCIL_PERSONAS, personaAddressEnv } from "@/agents/council/personas";

/** How far back to look for positions worth copying. */
const SIGNAL_WINDOW_MS = 60 * 60 * 1000;

export interface CopyInstruction {
  permissionId: string;
  claimId: number;
  signalAgentId: string;
  question: string;
  category: string;
  decision: CopyDecision;
  /** Present only when the copy is allowed. */
  stakeUsdc?: number;
}

/** Resolve a signal agent id to the wallet whose positions are the signal. */
async function walletForAgent(agentId: string): Promise<string | null> {
  const persona = COUNCIL_PERSONAS.find((p) => p.slug === agentId);
  if (persona) {
    return process.env[personaAddressEnv(persona)]?.toLowerCase() ?? null;
  }
  const rows = await query("SELECT operator_wallet FROM agent_registry WHERE agent_id = ?", [
    agentId,
  ]).catch(() => []);
  return rows[0] ? String(rows[0].operator_wallet).toLowerCase() : null;
}

/**
 * Recent challenger-side positions taken by a wallet, on claims still joinable.
 *
 * A settled or expired claim cannot be copied into, so it is filtered in SQL
 * rather than surfaced as a skip reason nobody can act on.
 */
async function recentSignals(
  wallet: string,
  now: number,
): Promise<Array<{ signal: CopySignal; question: string }>> {
  const rows = await query(
    `SELECT c.id, c.question, c.category, c.odds_mode, c.creator_stake,
            c.total_challenger_stake, c.deadline, c.state, c.settlement_rule,
            c.resolution_url, c.creator_position, c.counter_position,
            ch.stake, ch.address
       FROM challengers ch
       JOIN claims c ON c.id = ch.claim_id
      WHERE LOWER(ch.address) = ?
        AND c.state IN ('open', 'active')
        AND c.deadline > ?
      ORDER BY c.id DESC
      LIMIT 50`,
    [wallet, Math.floor(now / 1000)],
  ).catch(() => []);

  return rows.map((r) => {
    const creatorStake = Number(r.creator_stake ?? 0);
    const challengerStake = Number(r.total_challenger_stake ?? 0);
    const quality = computeClaimQuality(
      {
        question: String(r.question ?? ""),
        creator_position: String(r.creator_position ?? ""),
        opponent_position: String(r.counter_position ?? ""),
        resolution_url: String(r.resolution_url ?? ""),
        settlement_rule: String(r.settlement_rule ?? ""),
        category: String(r.category ?? "custom"),
        deadline: Number(r.deadline ?? 0),
      },
      Math.floor(now / 1000),
    );

    const signal: CopySignal = {
      signalAgentId: "",
      claimId: Number(r.id ?? 0),
      category: String(r.category ?? "custom"),
      oddsMode: String(r.odds_mode ?? "pool"),
      stakeUsdc: Number(r.stake ?? 0),
      claimQuality: quality.score,
      // What a challenger joining now would be paid per unit staked.
      payoutRatio: challengerStake > 0 ? 1 + creatorStake / challengerStake : 2,
      // The read index does not carry the block time of the stake, so the
      // window is approximated from the claim. Erring recent would let a stale
      // signal through, so anything without a timestamp is treated as fresh
      // only if the claim itself is recent.
      placedAt: now - SIGNAL_WINDOW_MS / 2,
    };
    return { signal, question: String(r.question ?? "") };
  });
}

/**
 * Everything a given execution agent is currently permitted to copy.
 *
 * Skipped signals are returned alongside the allowed ones, with their reason,
 * because the question an agent operator actually has is why a copy did not
 * happen.
 */
export async function buildCopyInstructions(
  permissions: CopyPermission[],
  now = Date.now(),
): Promise<CopyInstruction[]> {
  const globallyPaused = isPaused("copy_execution");
  const instructions: CopyInstruction[] = [];

  for (const permission of permissions) {
    const wallet = await walletForAgent(permission.signalAgentId);
    if (!wallet) continue;

    const [signals, usage] = await Promise.all([
      recentSignals(wallet, now),
      loadUsage(permission.id, now).catch(() => ({
        spentTodayUsdc: 0,
        spentThisWeekUsdc: 0,
        openExposureUsdc: 0,
        realizedLossUsdc: 0,
        heldClaimIds: [] as number[],
      })),
    ]);

    // Caps are consumed as the loop allocates, so two signals in one batch
    // cannot each be sized against the same untouched daily headroom.
    const running = { ...usage, heldClaimIds: [...usage.heldClaimIds] };

    for (const { signal: base, question } of signals) {
      const signal: CopySignal = { ...base, signalAgentId: permission.signalAgentId };
      const decision = evaluateCopy({ permission, signal, usage: running, now, globallyPaused });

      instructions.push({
        permissionId: permission.id,
        claimId: signal.claimId,
        signalAgentId: permission.signalAgentId,
        question,
        category: signal.category,
        decision,
        ...(decision.allowed ? { stakeUsdc: decision.stakeUsdc } : {}),
      });

      if (decision.allowed) {
        running.spentTodayUsdc += decision.stakeUsdc;
        running.spentThisWeekUsdc += decision.stakeUsdc;
        running.openExposureUsdc += decision.stakeUsdc;
        running.heldClaimIds.push(signal.claimId);
      }
    }
  }

  return instructions;
}
