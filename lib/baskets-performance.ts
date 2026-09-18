import "server-only";

/**
 * Turning on-chain history into a basket curve.
 *
 * A basket member is named by id (a council persona slug or a registered agent
 * id); the chain only knows wallets. This resolves ids to wallets, reads the
 * markets those wallets actually settled, and hands the pure simulator a list of
 * realized outcomes. Nothing here invents a return: if an agent never settled
 * anything, it contributes nothing.
 */
import { query } from "@/lib/db";
import { ONE_USDC } from "@/lib/fees";
import type { BasketMember, MemberSettlement } from "@/lib/baskets";
import { COUNCIL_PERSONAS, personaAddressEnv } from "@/agents/council/personas";

/** USDC stored as a decimal in the read index; the simulator wants atomic integers. */
function usdcToAtomic(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return (BigInt(Math.round(value * 1e6)) * ONE_USDC) / 1_000_000n;
}

function dayOf(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Map member ids to wallets.
 *
 * Council personas resolve from the deploy's env; registered agents from the
 * registry. An id that resolves to neither is dropped rather than guessed at.
 */
export async function resolveAgentWallets(agentIds: string[]): Promise<Map<string, string>> {
  const wanted = new Set(agentIds);
  const map = new Map<string, string>();

  for (const persona of COUNCIL_PERSONAS) {
    if (!wanted.has(persona.slug)) continue;
    const address = process.env[personaAddressEnv(persona)]?.toLowerCase();
    if (address) map.set(persona.slug, address);
  }

  const missing = agentIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const placeholders = missing.map(() => "?").join(",");
    const rows = await query(
      `SELECT agent_id, operator_wallet FROM agent_registry WHERE agent_id IN (${placeholders})`,
      missing,
    ).catch(() => []);
    for (const r of rows) {
      map.set(String(r.agent_id), String(r.operator_wallet).toLowerCase());
    }
  }

  return map;
}

/**
 * Realized outcomes for a basket's members.
 *
 * Only challenger-side positions are counted: that is what the council and the
 * BYOA agents actually take. A pool-mode win pays a proportional share of the
 * creator stake, a loss costs the stake, and a draw or unresolvable outcome
 * refunds in full and so contributes exactly zero.
 */
export async function loadMemberSettlements(members: BasketMember[]): Promise<MemberSettlement[]> {
  const wallets = await resolveAgentWallets(members.map((m) => m.agentId));
  if (wallets.size === 0) return [];

  const byWallet = new Map<string, string>();
  for (const [agentId, wallet] of wallets) byWallet.set(wallet, agentId);

  const addresses = [...byWallet.keys()];
  const placeholders = addresses.map(() => "?").join(",");

  const rows = await query(
    `SELECT ch.address, ch.stake, c.deadline, c.winner_side, c.creator_stake, c.total_challenger_stake
       FROM challengers ch
       JOIN claims c ON c.id = ch.claim_id
      WHERE LOWER(ch.address) IN (${placeholders})
        AND c.state = 'resolved'`,
    addresses,
  ).catch(() => []);

  const settlements: MemberSettlement[] = [];
  for (const r of rows) {
    const agentId = byWallet.get(String(r.address).toLowerCase());
    if (!agentId) continue;

    const stake = Number(r.stake ?? 0);
    if (!(stake > 0)) continue;

    const winner = String(r.winner_side ?? "");
    const creatorStake = Number(r.creator_stake ?? 0);
    const totalChallengerStake = Number(r.total_challenger_stake ?? 0);

    let pnl = 0;
    if (winner === "challengers") {
      pnl = totalChallengerStake > 0 ? (stake * creatorStake) / totalChallengerStake : 0;
    } else if (winner === "creator") {
      pnl = -stake;
    } else {
      // draw, unresolvable, or a verdict we do not recognise: fully refunded.
      pnl = 0;
    }

    settlements.push({
      agentId,
      day: dayOf(Number(r.deadline ?? 0)),
      stakeAtomic: usdcToAtomic(stake),
      pnlAtomic: pnl < 0 ? -usdcToAtomic(-pnl) : usdcToAtomic(pnl),
    });
  }

  return settlements;
}
