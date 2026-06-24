/**
 * Council vote, pay-per-call — binds the council to settlement (RFB #6 + the
 * Lepton multi-agent-consensus story).
 *
 * GET /api/council/vote?claimId=12&persona=optimist   ($0.001 / vote)
 *
 * The oracle BUYS each persona's verdict during settlement: it pays a sub-cent
 * nanopayment (settled into the persona's OWN wallet) and gets back a structured
 * vote. The oracle tallies these into the on-chain verdict — so every persona is
 * a paid juror, not just decoration. Unpaid → 402.
 *
 * Evidence is fetched server-side (free fetch only; a 402 source makes the
 * persona abstain rather than nest a payment).
 */

import { requirePayment, json } from "@/lib/x402-server";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { createArcPublicClient, getContractAddress } from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";
import { evaluateClaimAsPersona } from "@/agents/council/shared/persona-llm";
import { fetchEvidence } from "@/lib/server/evidence-fetcher";
import type { ClaimOnChain } from "@/agents/council/shared/types";

const PRICE = "$0.001";
const MAX_EVIDENCE_CHARS = 8_000;

function personaAddress(slug: string): string | undefined {
  return process.env[`CIRCLE_COUNCIL_${slug.toUpperCase().replace(/-/g, "_")}_ADDRESS`];
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const claimId = Number(searchParams.get("claimId"));
  const slug = (searchParams.get("persona") ?? "").toLowerCase().trim();

  // Validate BEFORE charging — never take payment for a request we can't serve.
  const persona = COUNCIL_PERSONAS.find((p) => p.slug === slug);
  if (!persona) return json({ error: `unknown persona '${slug}'` }, { status: 400 });
  if (!persona.promptBias) {
    // Rule-based personas (contrarian, whale-watcher) trade on pool dynamics,
    // not on evidence — they can't judge what actually happened.
    return json({ error: `persona '${slug}' does not vote on settlement` }, { status: 422 });
  }
  if (!Number.isInteger(claimId) || claimId < 1) {
    return json({ error: "claimId must be a positive integer" }, { status: 400 });
  }
  const payTo = personaAddress(slug);
  if (!payTo) return json({ error: `persona '${slug}' has no wallet configured` }, { status: 503 });

  // Payment gate — revenue lands in the persona's own wallet.
  const gate = await requirePayment(req, PRICE, { payTo });
  if (!gate.paid) return gate.response;

  // Read the claim from chain.
  let claim: ClaimOnChain;
  try {
    const pub = createArcPublicClient();
    const addr = getContractAddress();
    const [base, market] = await Promise.all([
      pub.readContract({ address: addr, abi: MIMIR_ABI, functionName: "getClaim", args: [BigInt(claimId)] }) as Promise<readonly unknown[]>,
      pub.readContract({ address: addr, abi: MIMIR_ABI, functionName: "getClaimMarketConfig", args: [BigInt(claimId)] }) as Promise<readonly unknown[]>,
    ]);
    if (!base[0] || base[0] === "0x0000000000000000000000000000000000000000") {
      return json({ error: `claim ${claimId} not found` }, { status: 404, headers: gate.responseHeaders });
    }
    claim = {
      id: claimId,
      creator: String(base[0]),
      question: String(base[1]),
      creatorPosition: String(base[2]),
      counterPosition: String(base[3]),
      resolutionUrl: String(base[4]),
      creatorStake: BigInt(base[5] as bigint),
      totalChallengerStake: BigInt(base[6] as bigint),
      deadline: BigInt(base[8] as bigint),
      state: Number(base[9]),
      category: String(base[13]),
      challengerCount: BigInt(base[15] as bigint),
      marketType: String(market[0]),
      maxChallengers: BigInt(market[5] as bigint),
      isPrivate: Boolean(market[6]),
      settlementRule: String(market[4]),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "read failed";
    return json({ error: msg }, { status: 502, headers: gate.responseHeaders });
  }

  // Specialists only vote within their category — otherwise abstain.
  if (
    persona.categoryFilter &&
    !persona.categoryFilter.some((c) => c.toLowerCase() === claim.category.toLowerCase())
  ) {
    return json(
      { persona: { slug, name: persona.displayName, emoji: persona.emoji }, claimId, verdict: "UNRESOLVABLE", confidence: 0, explanation: `[${persona.displayName} abstains — out of category]`, paidTo: payTo, price: PRICE },
      { headers: gate.responseHeaders },
    );
  }

  // Fetch evidence (free fetch; paywalled sources → abstain, no nested payment).
  let evidenceText = "(No resolution URL provided)";
  if (claim.resolutionUrl?.startsWith("http")) {
    try {
      const snap = await fetchEvidence(claim.resolutionUrl, { maxChars: MAX_EVIDENCE_CHARS, userAgent: "Mimir-Council/1.0" });
      evidenceText = snap.text;
    } catch {
      evidenceText = "(Failed to fetch evidence)";
    }
  }

  const verdict = await evaluateClaimAsPersona(persona, claim, evidenceText);

  return json(
    {
      persona: { slug, name: persona.displayName, emoji: persona.emoji },
      claimId,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      explanation: verdict.explanation,
      paidTo: payTo,
      price: PRICE,
    },
    { headers: gate.responseHeaders },
  );
}
