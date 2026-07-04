/**
 * Council-as-jury for settlement.
 *
 * During settlement the oracle BUYS each eligible persona's verdict via an x402
 * nanopayment (settled into the persona's own wallet through the paid
 * /api/council/vote endpoint), then tallies the votes into the on-chain verdict.
 * This is what binds the 10 personas to settlement: every juror is paid, and
 * the consensus — not a single oracle call — decides the payout.
 *
 * Best-effort: any persona that errors or times out simply abstains. If fewer
 * than `quorum` decisive votes come back, returns null so the caller falls back
 * to its own (solo) verdict — council voting never blocks a settlement.
 */

import { COUNCIL_PERSONAS, type PersonaSpec } from "../council/personas";
import { fetchWithBudget, usdcToAtomic, type PayingAgent } from "../../lib/x402";
import { isVerdict, type Verdict } from "../../lib/verdict";

export type { Verdict };

export interface CouncilVote {
  slug: string;
  displayName: string;
  verdict: Verdict;
  confidence: number;
  pricePaidAtomic: string | null; // USDC 6dp, null if free/unsettled
}

export interface CouncilVerdict {
  verdict: Verdict;
  confidence: number;
  explanation: string;
  tally: { creator: number; challengers: number; draw: number; unresolvable: number; decisive: number };
  votes: CouncilVote[];
  totalPaidAtomic: bigint;
}

/** Personas that can judge a claim: evidence-reasoning (have a promptBias) and,
 *  for specialists, only within their category. Rule-based traders abstain. */
function eligiblePersonas(category: string): PersonaSpec[] {
  const cat = category.toLowerCase();
  return COUNCIL_PERSONAS.filter(
    (p) =>
      !!p.promptBias &&
      (!p.categoryFilter || p.categoryFilter.some((c) => c.toLowerCase() === cat)),
  );
}

interface VoteResponse {
  verdict?: Verdict;
  confidence?: number;
}

export async function gatherCouncilVerdict(args: {
  claimId: number;
  category: string;
  baseUrl: string;
  payer: PayingAgent;
  votePriceUsdc?: number;
  capUsdc?: number;
  quorum?: number;
}): Promise<CouncilVerdict | null> {
  const capAtomic = usdcToAtomic(args.capUsdc ?? 0.005);
  const quorum = args.quorum ?? 3;
  const personas = eligiblePersonas(args.category);
  if (personas.length === 0) return null;

  const votes: CouncilVote[] = [];
  let totalPaidAtomic = 0n;

  // Sequential: keeps within Gemini free-tier RPM and Gateway rate limits.
  for (const p of personas) {
    const url = `${args.baseUrl.replace(/\/$/, "")}/api/council/vote?claimId=${args.claimId}&persona=${encodeURIComponent(p.slug)}`;
    try {
      const r = await fetchWithBudget(url, args.payer, capAtomic);
      if (!r.response.ok) continue;
      const body = (await r.response.json()) as VoteResponse;
      const verdict = body.verdict;
      if (!isVerdict(verdict)) {
        continue;
      }
      const priceAtomic = r.payment?.priceAtomic ?? null;
      if (priceAtomic != null) totalPaidAtomic += priceAtomic;
      votes.push({
        slug: p.slug,
        displayName: p.displayName,
        verdict,
        confidence: Math.max(0, Math.min(100, Math.round(body.confidence ?? 0))),
        pricePaidAtomic: priceAtomic != null ? priceAtomic.toString() : null,
      });
    } catch {
      // persona abstains on any error
    }
  }

  const tally = { creator: 0, challengers: 0, draw: 0, unresolvable: 0, decisive: 0 };
  for (const v of votes) {
    if (v.verdict === "CREATOR_WINS") tally.creator++;
    else if (v.verdict === "CHALLENGERS_WIN") tally.challengers++;
    else if (v.verdict === "DRAW") tally.draw++;
    else tally.unresolvable++;
  }
  tally.decisive = tally.creator + tally.challengers;

  // Not enough jurors voted decisively — let the caller settle solo.
  if (tally.decisive < quorum) return null;

  let verdict: Verdict;
  let winningVotes: CouncilVote[];
  if (tally.creator > tally.challengers) {
    verdict = "CREATOR_WINS";
    winningVotes = votes.filter((v) => v.verdict === "CREATOR_WINS");
  } else if (tally.challengers > tally.creator) {
    verdict = "CHALLENGERS_WIN";
    winningVotes = votes.filter((v) => v.verdict === "CHALLENGERS_WIN");
  } else {
    // Split jury — refund rather than guess.
    verdict = "UNRESOLVABLE";
    winningVotes = [];
  }

  // Confidence = avg of the majority's confidence, scaled by how lopsided the
  // decisive vote was (a 7–1 majority is firmer than 4–3).
  const avgConf =
    winningVotes.length > 0
      ? winningVotes.reduce((s, v) => s + v.confidence, 0) / winningVotes.length
      : 0;
  const agreement = tally.decisive > 0 ? Math.max(tally.creator, tally.challengers) / tally.decisive : 0;
  const confidence = Math.round(avgConf * agreement);

  const side = verdict === "CREATOR_WINS" ? "CREATOR" : verdict === "CHALLENGERS_WIN" ? "CHALLENGERS" : "SPLIT";
  const abstain = tally.draw + tally.unresolvable;
  const explanation = `[council ${tally.creator}–${tally.challengers} → ${side}${abstain ? `, ${abstain} abstain` : ""}] ${winningVotes[0]?.displayName ?? "Jury"} et al.`.slice(0, 500);

  return { verdict, confidence, explanation, tally, votes, totalPaidAtomic };
}
