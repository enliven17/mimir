/**
 * Council subscription — one nanopayment buys a window of free council reads.
 *
 * POST /api/council/subscribe   ($0.01 → platform seller)
 *   → { pass, expiresAt, plan }
 *
 * Send the returned token as the `x-mimir-pass` header (or `&pass=` on older
 * clients) to /api/council/reasoning and reads are free until it expires
 * (default 10 min) or its read budget runs out (COUNCIL_PASS_READ_LIMIT). This
 * is the recurring/streaming access tier on top of the per-read nanopayment.
 * Unpaid → 402.
 */

import { requirePayment, json } from "@/lib/x402-server";
import { issuePass } from "@/lib/x402-pass";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { priceOf } from "@/lib/x402-resources";

const PRICE = priceOf("councilSubscribe");
const PLAN = "council";
const TTL_MS = Number(process.env.COUNCIL_PASS_TTL_MS ?? 10 * 60 * 1000);

export async function POST(req: Request): Promise<Response> {
  const gate = await requirePayment(req, PRICE);
  if (!gate.paid) return gate.response;

  // Bind the pass to whoever paid (best-effort — the settlement header carries it).
  let payer = "anonymous";
  const h = gate.responseHeaders.get("x-payment-response") ?? gate.responseHeaders.get("payment-response");
  if (h) {
    try {
      const s = decodePaymentResponseHeader(h) as { payer?: string };
      if (s.payer) payer = s.payer;
    } catch {
      /* keep anonymous */
    }
  }

  const { pass, expiresAt } = issuePass(payer, PLAN, TTL_MS);
  return json(
    { plan: PLAN, payer, pass, expiresAt, ttlMs: TTL_MS, price: PRICE },
    { headers: gate.responseHeaders },
  );
}
