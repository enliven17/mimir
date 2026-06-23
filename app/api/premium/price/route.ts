/**
 * Premium price oracle — sold per request over x402 ($0.001 / call).
 *
 * GET /api/premium/price?symbol=bitcoin
 *
 * This is the SELL side of Mimir's nanopayment economy: a paywalled data
 * source any agent can buy from. Mimir's own oracle pays this endpoint when a
 * claim's resolution URL points here — closing the loop where one agent earns
 * USDC by serving another agent's data need (RFB #1 + #2).
 *
 * Unpaid requests get a 402 with payment requirements; paid requests get a
 * deterministic price snapshot suitable for on-chain settlement.
 */

import { requirePayment, json } from "@/lib/x402-server";

const COINGECKO = "https://api.coingecko.com/api/v3";
const PRICE_USDC = "$0.001";

export async function GET(req: Request): Promise<Response> {
  // 1. Gate behind payment. 402 until the caller pays.
  const gate = await requirePayment(req, PRICE_USDC);
  if (!gate.paid) return gate.response;

  // 2. Paid — serve the data.
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "bitcoin")
    .toLowerCase()
    .trim();
  if (!/^[a-z0-9-]+$/.test(symbol)) {
    return json({ error: "invalid symbol" }, { status: 400, headers: gate.responseHeaders });
  }

  try {
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;

    const res = await fetch(
      `${COINGECKO}/simple/price?ids=${encodeURIComponent(symbol)}&vs_currencies=usd&include_last_updated_at=true`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) {
      return json(
        { error: `upstream ${res.status}` },
        { status: 502, headers: gate.responseHeaders },
      );
    }
    const payload = (await res.json()) as Record<string, { usd?: number; last_updated_at?: number }>;
    const row = payload[symbol];
    if (!row || typeof row.usd !== "number") {
      return json({ error: "unknown symbol" }, { status: 404, headers: gate.responseHeaders });
    }

    // Deterministic, LLM-friendly snapshot — the same shape the oracle expects.
    return json(
      {
        source: "Mimir Premium Price Oracle",
        symbol,
        price_usd: row.usd,
        last_updated_at: row.last_updated_at ?? null,
        fetched_at: Math.floor(Date.now() / 1000),
        paid: PRICE_USDC,
      },
      { headers: gate.responseHeaders },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return json({ error: msg }, { status: 502, headers: gate.responseHeaders });
  }
}
