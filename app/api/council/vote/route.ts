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
import { fetchDecodedClaim } from "@/lib/claim-codec";
import { evaluateClaimAsPersona } from "@/agents/council/shared/persona-llm";
import { fetchEvidence } from "@/lib/server/evidence-fetcher";
import type { ClaimOnChain } from "@/agents/council/shared/types";

const PRICE = "$0.001";
const MAX_EVIDENCE_CHARS = 8_000;

function personaAddress(slug: string): string | undefined {
  return process.env[`CIRCLE_COUNCIL_${slug.toUpperCase().replace(/-/g, "_")}_ADDRESS`];
}

/**
 * Optional `history` param: prior jurors' reports for sequential
 * (self-resolving) voting. URL-encoded JSON array of strings; anything
 * malformed degrades to an empty history rather than failing the vote.
 */
function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 8)
      .map((entry) => entry.slice(0, 300));
  } catch {
    return [];
  }
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const claimId = Number(searchParams.get("claimId"));
  const slug = (searchParams.get("persona") ?? "").toLowerCase().trim();
  const history = parseHistory(searchParams.get("history"));

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
    const decoded = await fetchDecodedClaim(createArcPublicClient(), getContractAddress(), claimId);
    if (!decoded) {
      return json({ error: `claim ${claimId} not found` }, { status: 404, headers: gate.responseHeaders });
    }
    claim = decoded;
  } catch (err) {
    console.error("[council/vote] claim read failed:", err instanceof Error ? err.message : err);
    return json({ error: "claim read failed" }, { status: 502, headers: gate.responseHeaders });
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

  const verdict = await evaluateClaimAsPersona(persona, claim, evidenceText, history);

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
