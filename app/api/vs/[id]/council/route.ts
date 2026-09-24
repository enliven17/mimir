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
  createChainPublicClient,
  getContractAddress,
  getDeployBlock,
  paginatedGetLogs,
} from "@/lib/arc";
import { stakeUnitsToUsdc, type ChainKey } from "@/lib/chains";
import { parseChainParam } from "@/lib/server/api-validation";
import { cachedFor } from "@/lib/server/ttl-cache";
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
  chain:      string;
  total:      number;
  stakedCount: number;
  totalUsdc:  number;
  votes:      PersonaVote[];
}

/**
 * ClaimChallenged logs for one claim, scanned from the deploy block. Cached per
 * instance for the same 20s the response is, so a burst of views (or random
 * ids from a scraper) costs one scan per claim rather than one per request.
 */
const challengeLogs = cachedFor(async (chain: ChainKey, claimId: number): Promise<any[]> => {
  return paginatedGetLogs(createChainPublicClient(chain), {
    address: getContractAddress(chain),
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
  } as any, getDeployBlock(chain));
}, 20_000);

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await ctx.params;
  const claimId = Number(rawId);
  if (!Number.isInteger(claimId) || claimId <= 0) {
    return NextResponse.json({ error: "invalid claim id" }, { status: 400 });
  }

  const chain = parseChainParam(new URL(req.url).searchParams.get("chain"));
  if (!chain) {
    return NextResponse.json({ error: "unknown chain" }, { status: 400 });
  }

  // Persona addresses are the same on every chain (W3S wallets are derived
  // from one wallet set), so only the escrow being scanned changes.
  let logs: any[];
  try {
    logs = await challengeLogs(chain, claimId);
  } catch (err) {
    // An RPC failure is not "no persona staked": say so, and keep CDNs from caching it.
    console.error("[api/vs/council] log fetch failed:", err);
    return NextResponse.json(
      { error: "chain read failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
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
      stakeUsdc:   hit ? stakeUnitsToUsdc(chain, hit.stake) : 0,
      txHash:      hit?.txHash ?? null,
      blockNumber: hit?.blockNumber ?? null,
    };
  });

  const stakedCount = votes.filter((v) => v.staked).length;
  const totalUsdc   = votes.reduce((acc, v) => acc + v.stakeUsdc, 0);

  const body: CouncilResponse = {
    claimId,
    chain,
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
