/**
 * Mimir Oracle-as-a-Service — sell the oracle's verdict per call over x402.
 *
 * POST /api/oracle   ($0.005 / verdict)
 *   body: { question, sideA, sideB, evidenceUrl, settlementRule? }
 *
 * This monetizes Mimir's core competency — reading evidence and judging an
 * outcome — as a standalone, pay-per-call service (RFB #2: selling agent
 * services). Any agent or app pays a nanopayment and gets back a verdict with
 * confidence + an evidence hash they can verify themselves.
 *
 * Unpaid → 402 with payment requirements. Paid → the verdict.
 */

import { keccak256, toBytes } from "viem";
import { requirePayment, json } from "@/lib/x402-server";
import { callLLM, extractJson } from "@/lib/llm";
import { fetchEvidence } from "@/lib/server/evidence-fetcher";

const PRICE = "$0.005";
const MAX_EVIDENCE_CHARS = 8_000;

interface VerdictRequest {
  question?: string;
  sideA?: string;
  sideB?: string;
  evidenceUrl?: string;
  settlementRule?: string;
}

export async function POST(req: Request): Promise<Response> {
  // 1. Payment gate.
  const gate = await requirePayment(req, PRICE);
  if (!gate.paid) return gate.response;

  // 2. Parse + validate the question (body untouched by the payment shim).
  let body: VerdictRequest;
  try {
    body = (await req.json()) as VerdictRequest;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400, headers: gate.responseHeaders });
  }
  const question = body.question?.trim();
  const sideA = body.sideA?.trim();
  const sideB = body.sideB?.trim();
  const evidenceUrl = body.evidenceUrl?.trim();
  if (!question || !sideA || !sideB || !evidenceUrl) {
    return json(
      { error: "question, sideA, sideB, evidenceUrl are required" },
      { status: 400, headers: gate.responseHeaders },
    );
  }
  if (!/^https?:\/\//.test(evidenceUrl)) {
    return json({ error: "evidenceUrl must be http(s)" }, { status: 400, headers: gate.responseHeaders });
  }

  // 3. Fetch evidence + judge. Same evidence-hash discipline as on-chain settle.
  let evidenceText = "(no evidence)";
  let fetcher = "none";
  try {
    const snap = await fetchEvidence(evidenceUrl, { maxChars: MAX_EVIDENCE_CHARS, userAgent: "Mimir-OracleAPI/1.0" });
    evidenceText = snap.text;
    fetcher = snap.fetcher;
  } catch {
    /* fall through with placeholder; LLM will likely return UNRESOLVABLE */
  }

  const prompt = `You are Mimir, an impartial AI oracle. Decide whether Side A or Side B is correct based ONLY on the evidence.

**Question:** ${question}
**Side A:** ${sideA}
**Side B:** ${sideB}
**Settlement rule:** ${body.settlementRule?.trim() || "Use the evidence to determine the outcome."}

<evidence>
${evidenceText}
</evidence>

Return JSON only:
{ "verdict": "SIDE_A" | "SIDE_B" | "DRAW" | "UNRESOLVABLE", "confidence": <0-100>, "explanation": "<one paragraph>" }
- UNRESOLVABLE if the evidence is missing or ambiguous.
- Only exceed 80 confidence when the evidence is unambiguous.`;

  let verdict = "UNRESOLVABLE";
  let confidence = 0;
  let explanation = "Oracle failed to parse response.";
  try {
    const text = await callLLM(prompt, { maxTokens: 1024, jsonOnly: true });
    const m = extractJson(text);
    if (m) {
      const parsed = JSON.parse(m) as { verdict?: string; confidence?: number; explanation?: string };
      if (["SIDE_A", "SIDE_B", "DRAW", "UNRESOLVABLE"].includes(parsed.verdict ?? "")) {
        verdict = parsed.verdict!;
        confidence = Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 50)));
        explanation = (parsed.explanation ?? "").slice(0, 500);
      }
    }
  } catch {
    /* keep defaults */
  }

  return json(
    {
      verdict,
      confidence,
      explanation,
      evidenceHash: keccak256(toBytes(evidenceText)),
      evidenceFetcher: fetcher,
      price: PRICE,
    },
    { headers: gate.responseHeaders },
  );
}
