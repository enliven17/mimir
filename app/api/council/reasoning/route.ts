/**
 * Council reasoning, pay-per-read — creator monetization (RFB #6, primary).
 *
 * GET /api/council/reasoning?claimId=12&persona=optimist   ($0.001 / read)
 *
 * Each of the 10 council personas is a "creator": a reader pays a nanopayment
 * to unlock that persona's take on a claim, and the USDC settles DIRECTLY into
 * that persona's own wallet (payTo = persona address). Unpaid → 402.
 */

import { requirePayment, json } from "@/lib/x402-server";
import { verifyPass } from "@/lib/x402-pass";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { createArcPublicClient, getContractAddress } from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";
import { callLLM } from "@/lib/llm";

const PRICE = "$0.001";
const PASS_PLAN = "council";

function personaAddress(slug: string): string | undefined {
  const env = `CIRCLE_COUNCIL_${slug.toUpperCase().replace(/-/g, "_")}_ADDRESS`;
  return process.env[env];
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const claimId = Number(searchParams.get("claimId"));
  const slug = (searchParams.get("persona") ?? "").toLowerCase().trim();

  // Validate BEFORE charging — never take payment for a request we can't serve.
  const persona = COUNCIL_PERSONAS.find((p) => p.slug === slug);
  if (!persona) {
    return json({ error: `unknown persona '${slug}'` }, { status: 400 });
  }
  if (!Number.isInteger(claimId) || claimId < 1) {
    return json({ error: "claimId must be a positive integer" }, { status: 400 });
  }
  const payTo = personaAddress(slug);
  if (!payTo) {
    return json({ error: `persona '${slug}' has no wallet configured` }, { status: 503 });
  }

  // A valid subscription pass unlocks reads for its window — skip the per-read
  // 402. Otherwise charge the nanopayment into the persona's own wallet.
  const hasPass = !!verifyPass(searchParams.get("pass"), PASS_PLAN);
  let responseHeaders: Headers | undefined;
  if (!hasPass) {
    const gate = await requirePayment(req, PRICE, { payTo });
    if (!gate.paid) return gate.response;
    responseHeaders = gate.responseHeaders;
  }

  // Read the claim, then produce this persona's reasoning.
  let question = "";
  let sideA = "";
  let sideB = "";
  try {
    const base = (await createArcPublicClient().readContract({
      address: getContractAddress(),
      abi: MIMIR_ABI,
      functionName: "getClaim",
      args: [BigInt(claimId)],
    })) as readonly unknown[];
    if (!base[0] || base[0] === "0x0000000000000000000000000000000000000000") {
      return json({ error: `claim ${claimId} not found` }, { status: 404, headers: responseHeaders });
    }
    question = String(base[1]);
    sideA = String(base[2]);
    sideB = String(base[3]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "read failed";
    return json({ error: msg }, { status: 502, headers: responseHeaders });
  }

  const prompt = `${persona.promptBias}

You are giving your personal take, in character, on a prediction market claim.

**Claim:** ${question}
**Side A (creator):** ${sideA}
**Side B (challenger):** ${sideB}

Write one tight paragraph (max 90 words): which side you lean toward and your honest reasoning. Stay in character.`;

  let reasoning = "";
  try {
    reasoning = (await callLLM(prompt, { maxTokens: 300 })).trim();
  } catch {
    reasoning = "(reasoning unavailable right now)";
  }

  return json(
    {
      persona: { slug: persona.slug, name: persona.displayName, emoji: persona.emoji },
      claimId,
      question,
      reasoning,
      paidTo: hasPass ? null : payTo,
      price: hasPass ? "$0.00 (pass)" : PRICE,
    },
    { headers: responseHeaders },
  );
}
