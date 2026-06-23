/**
 * GET /api/x402/revenue — live nanopayment earnings across Mimir's paid
 * endpoints (premium price oracle, oracle-as-a-service, council reasoning).
 *
 * Powers the /revenue dashboard. Reflects payments since the last server boot
 * (in-memory ledger); on-chain Gateway balance is the durable record.
 */

import { getRevenueSummary } from "@/lib/x402-revenue";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const summary = getRevenueSummary(25);
  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
