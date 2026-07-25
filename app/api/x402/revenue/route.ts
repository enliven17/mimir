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
    headers: {
      "content-type": "application/json",
      // Served from the edge between refreshes: the dashboard polls this every few
      // seconds and every uncached hit was a function invocation running four
      // aggregates over x402_payments. 10s of staleness on a counter is invisible.
      "cache-control": "s-maxage=10, stale-while-revalidate=30",
    },
  });
}
