/**
 * Paid council preflight for the market-creator.
 *
 * The market-creator buys short persona opinions before opening a market. This
 * turns council personas into information sellers before settlement, not only
 * jurors after the deadline.
 */

import { COUNCIL_PERSONAS } from "../council/personas";
import { fetchWithBudget, usdcToAtomic, type PayingAgent } from "../../lib/x402";

export interface ClaimCandidateForPreflight {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  marketType: string;
  settlementRule: string;
  deadlineHours: number;
  qualityScore: number;
  sourceType: string;
}

export interface CouncilPreflightOpinion {
  slug: string;
  displayName: string;
  decision: "open" | "revise" | "skip";
  score: number;
  confidence: number;
  reasoning: string;
  pricePaidAtomic: string | null;
}

export interface CouncilPreflightResult {
  opinions: CouncilPreflightOpinion[];
  averageScore: number | null;
  openVotes: number;
  reviseVotes: number;
  skipVotes: number;
  totalPaidAtomic: bigint;
}

interface PreflightResponse {
  decision?: string;
  score?: number;
  confidence?: number;
  reasoning?: string;
}

function selectedPersonas(raw: string | undefined) {
  const slugs = (raw ?? "optimist,pessimist,statistician,contrarian,doomer")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const wanted = new Set(slugs);
  return COUNCIL_PERSONAS.filter((p) => wanted.has(p.slug));
}

function parseDecision(value: unknown): "open" | "revise" | "skip" {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "open" || normalized === "revise" || normalized === "skip") {
    return normalized;
  }
  return "revise";
}

export async function gatherCouncilPreflight(args: {
  candidate: ClaimCandidateForPreflight;
  baseUrl: string;
  payer: PayingAgent;
  personaCsv?: string;
  capUsdc?: number;
  delayMs?: number;
}): Promise<CouncilPreflightResult> {
  const capAtomic = usdcToAtomic(args.capUsdc ?? 0.005);
  const personas = selectedPersonas(args.personaCsv);
  const opinions: CouncilPreflightOpinion[] = [];
  let totalPaidAtomic = 0n;

  for (const persona of personas) {
    const url = `${args.baseUrl.replace(/\/$/, "")}/api/council/preflight?persona=${encodeURIComponent(persona.slug)}`;
    try {
      const result = await fetchWithBudget(url, args.payer, capAtomic, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.candidate),
      });
      if (!result.response.ok) continue;
      const body = (await result.response.json()) as PreflightResponse;
      const priceAtomic = result.payment?.priceAtomic ?? null;
      if (priceAtomic != null) totalPaidAtomic += priceAtomic;
      opinions.push({
        slug: persona.slug,
        displayName: persona.displayName,
        decision: parseDecision(body.decision),
        score: Math.max(0, Math.min(100, Math.round(Number(body.score ?? 50)))),
        confidence: Math.max(0, Math.min(100, Math.round(Number(body.confidence ?? 50)))),
        reasoning: String(body.reasoning ?? "").slice(0, 400),
        pricePaidAtomic: priceAtomic != null ? priceAtomic.toString() : null,
      });
    } catch {
      // Preflight is advisory. A persona that errors simply abstains.
    }

    if (args.delayMs && args.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    }
  }

  const averageScore =
    opinions.length > 0
      ? opinions.reduce((sum, opinion) => sum + opinion.score, 0) / opinions.length
      : null;

  return {
    opinions,
    averageScore,
    openVotes: opinions.filter((opinion) => opinion.decision === "open").length,
    reviseVotes: opinions.filter((opinion) => opinion.decision === "revise").length,
    skipVotes: opinions.filter((opinion) => opinion.decision === "skip").length,
    totalPaidAtomic,
  };
}
