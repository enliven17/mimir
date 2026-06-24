/**
 * GET /api/x402/revenue — live nanopayment earnings across Mimir's paid
 * endpoints (premium price oracle, oracle-as-a-service, council reasoning).
 *
 * Powers the /revenue dashboard. Durable: reads the Neon x402_payments ledger
 * (falls back to an in-memory buffer when no DB is configured). On-chain Gateway
 * balance remains the ultimate record.
 */

import { getRevenueSummary } from "@/lib/x402-revenue";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const summary = await getRevenueSummary(25);
  return new Response(JSON.stringify(summary), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
