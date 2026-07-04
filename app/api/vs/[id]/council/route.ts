/**
 * GET /api/vs/[id]/council
 *
 * Returns the council's record on a single claim:
 *   - which personas have staked on the challenger side
 *   - how much each persona staked
 *   - the tx hash that proves it
 *
 * Pure on-chain read of ClaimChallenged logs filtered to the claim ID,
 * cross-referenced against the active council persona addresses. No LLM
 * calls happen here — the worker handles those off-band — so this route
 * is cheap and cacheable.
 */

import { NextResponse } from "next/server";
import {
  createArcPublicClient,
  getContractAddress,
  getDeployBlock,
  weiToUsdc,
  paginatedGetLogs,
} from "@/lib/arc";
import {
  COUNCIL_PERSONAS,
  personaAddressEnv,
  type PersonaSpec,
} from "@/agents/council/personas";

export const revalidate = 20;

interface PersonaVote {
  slug:        string;
  displayName: string;
  emoji:       string;
  archetype:   PersonaSpec["archetype"];
  accent:      PersonaSpec["accent"];
  staked:      boolean;
  stakeUsdc:   number;
  txHash:      string | null;
  blockNumber: number | null;
}

interface CouncilResponse {
  claimId:    number;
  total:      number;
  stakedCount: number;
  totalUsdc:  number;
  votes:      PersonaVote[];
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const claimId = Number(rawId);
  if (!Number.isFinite(claimId) || claimId <= 0) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }

  const client    = createArcPublicClient();
  const address   = getContractAddress();
  const fromBlock = getDeployBlock();

  let logs: any[] = [];
  try {
    logs = await paginatedGetLogs(client, {
      address,
      event: {
        type: "event",
        name: "ClaimChallenged",
        inputs: [
          { name: "id",         type: "uint256", indexed: true },
          { name: "challenger", type: "address", indexed: true },
          { name: "stake",      type: "uint256", indexed: false },
        ],
      },
      // `args` is a sibling of `event` in viem's getLogs filter — placing it
      // inside the event object silently disables the indexed-topic filter
      // and returns ChallengeChallenged logs across ALL claims, which then
      // smear every persona's stakes onto whichever claim page is open.
      args: { id: BigInt(claimId) },
    } as any, fromBlock);
  } catch (err) {
    console.error("[api/vs/council] log fetch failed:", err);
  }

  const stakeByAddress = new Map<string, { stake: bigint; txHash: string; blockNumber: number }>();
  for (const log of logs) {
    const actor = String(log.args.challenger ?? "").toLowerCase();
    if (!actor) continue;
    const stake = BigInt(log.args.stake ?? 0);
    const existing = stakeByAddress.get(actor);
    if (!existing || stake > existing.stake) {
      stakeByAddress.set(actor, {
        stake,
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      });
    }
  }

  const votes: PersonaVote[] = COUNCIL_PERSONAS.map((p) => {
    const addr = process.env[personaAddressEnv(p)]?.toLowerCase();
    const hit = addr ? stakeByAddress.get(addr) : undefined;
    return {
      slug:        p.slug,
      displayName: p.displayName,
      emoji:       p.emoji,
      archetype:   p.archetype,
      accent:      p.accent,
      staked:      !!hit,
      stakeUsdc:   hit ? weiToUsdc(hit.stake) : 0,
      txHash:      hit?.txHash ?? null,
      blockNumber: hit?.blockNumber ?? null,
    };
  });

  const stakedCount = votes.filter((v) => v.staked).length;
  const totalUsdc   = votes.reduce((acc, v) => acc + v.stakeUsdc, 0);

  const body: CouncilResponse = {
    claimId,
    total:       votes.length,
    stakedCount,
    totalUsdc,
    votes,
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
    },
  });
}
