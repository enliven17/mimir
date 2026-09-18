/**
 * GET /api/x402/resources — what Mimir sells, and what it costs.
 *
 * A discovery document for buying agents. Prices come from the same catalogue
 * the 402 challenges quote, so this can never advertise a price the payment
 * flow does not honour.
 */
import { resourceCatalogue } from "@/lib/x402-resources";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const base = process.env.MIMIR_BASE_URL?.trim() || new URL(req.url).origin;

  return new Response(
    JSON.stringify({
      protocol: "x402",
      network: "arc-testnet",
      asset: "USDC",
      note: "Request any resource without payment to receive its 402 challenge with the exact payment requirements.",
      resources: resourceCatalogue(base),
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "s-maxage=300, stale-while-revalidate=900",
      },
    },
  );
}
