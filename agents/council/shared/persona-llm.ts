/**
 * LLM evaluation with a persona-specific prompt bias.
 *
 * Wraps the same evaluation logic the oracle uses, but prepends each
 * persona's `promptBias` so the LLM "thinks" through that worldview.
 * Output schema and confidence parsing match the oracle exactly so the
 * downstream Kelly sizing + commit logic can be shared.
 */

import { callLLM, pickGeminiModel } from "../../../lib/llm";
import { microToUsdc } from "../../../lib/arc";
import type { PersonaSpec } from "../personas";
import type { ClaimOnChain } from "./types";

export interface PersonaVerdict {
  /**
   * CREATOR_WINS means the persona sides with the creator's position →
   * the persona will NOT stake (it cannot join the creator's side).
   * CHALLENGERS_WIN means the persona disagrees with the creator → stake.
   * DRAW / UNRESOLVABLE → abstain.
   */
  verdict:     "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE";
  confidence:  number;
  explanation: string;
}

export async function evaluateClaimAsPersona(
  persona: PersonaSpec,
  claim: ClaimOnChain,
  evidenceText: string,
  peerReasoning: string[] = [],
): Promise<PersonaVerdict> {
  const deadlineDate = new Date(Number(claim.deadline) * 1000).toISOString();
  const nowDate      = new Date().toISOString();
  const potUsdc      = microToUsdc(claim.creatorStake + claim.totalChallengerStake);

  const biasSection = persona.promptBias
    ? `\n## Your character\n${persona.promptBias}\n`
    : "";
  const peerSection = peerReasoning.length > 0
    ? `\n## Paid peer reads you bought over x402\n${peerReasoning.map((read, i) => `${i + 1}. ${read}`).join("\n")}\n\nUse these as other council members' opinions, not as primary evidence. You may agree, dissent, or discount them.\n`
    : "";

  const prompt = `You are ${persona.displayName}, one of ten AI personas on the Mimir Council — a USDC prediction-market jury on Arc blockchain.
${biasSection}
## Time context (TRUST THIS, ignore your training cutoff)
- Current UTC time: ${nowDate}
- Claim deadline:   ${deadlineDate}

## Claim
**Question:** ${claim.question}
**Creator position (Side A):** ${claim.creatorPosition}
**Challenger position (Side B):** ${claim.counterPosition}
**Category:** ${claim.category}
**Market type:** ${claim.marketType}
**Settlement rule:** ${claim.settlementRule || "Use the linked source to determine the outcome."}
**Resolution URL:** ${claim.resolutionUrl}
**Pool:** ${potUsdc.toFixed(2)} USDC

## Web Evidence (already fetched on your behalf)
<evidence>
${evidenceText}
</evidence>
${peerSection}

Decide which side will win when the claim is resolved.

Return JSON only:
{
  "verdict": "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE",
  "confidence": <0-100>,
  "explanation": "<one or two sentences in your voice>"
}

- UNRESOLVABLE only if the evidence is missing, ambiguous, or doesn't contain the data needed.
- Stay in character (${persona.displayName}) when writing the explanation.
- Never invent evidence. Cite what you actually saw above.`;

  const text = await callLLM(prompt, {
    maxTokens: 512,
    jsonOnly: true,
    model: pickGeminiModel(persona.slug),
  });

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]) as PersonaVerdict;
    if (!["CREATOR_WINS", "CHALLENGERS_WIN", "DRAW", "UNRESOLVABLE"].includes(parsed.verdict)) {
      throw new Error("Invalid verdict");
    }
    return {
      verdict:     parsed.verdict,
      confidence:  Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 50))),
      explanation: (parsed.explanation ?? "").slice(0, 500),
    };
  } catch {
    return {
      verdict:     "UNRESOLVABLE",
      confidence:  0,
      explanation: `[${persona.displayName} failed to parse LLM response]`,
    };
  }
}
