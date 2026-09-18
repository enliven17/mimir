/**
 * Independent price readings for settlement cross-checks.
 *
 * "Independent" is the load-bearing word: two endpoints of the same aggregator
 * would agree with each other about the same mistake. CoinGecko and
 * CoinMarketCap run separate exchange sets and separate weighting, so when they
 * agree the number is not in doubt, and when they do not, something is wrong.
 *
 * Both are best-effort. A source being down degrades the settlement to a single
 * reading, which is what the oracle did before this existed; it never blocks it.
 */

import type { PriceReading } from "../price-consensus";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CMC_BASE = "https://pro-api.coinmarketcap.com/v1";
const TIMEOUT_MS = 10_000;

/** CoinGecko is keyed by its own ids, not by ticker. */
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  MATIC: "matic-network",
  DOT: "polkadot",
};

export function coingeckoIdFor(symbol: string): string | null {
  return COINGECKO_IDS[symbol.toUpperCase()] ?? null;
}

async function fetchCoinGeckoPrice(symbol: string): Promise<PriceReading | null> {
  const id = coingeckoIdFor(symbol);
  if (!id) return null;

  try {
    const res = await fetch(
      `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_last_updated_at=true`,
      { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, { usd?: number; last_updated_at?: number }>;
    const entry = body[id];
    const price = Number(entry?.usd);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      source: "coingecko",
      priceUsd: price,
      // Seconds in this endpoint; fall back to now when the field is absent.
      at: entry?.last_updated_at ? entry.last_updated_at * 1000 : Date.now(),
    };
  } catch {
    return null;
  }
}

async function fetchCmcPrice(symbol: string): Promise<PriceReading | null> {
  const key = process.env.CMC_API_KEY?.trim();
  if (!key) return null;

  try {
    const res = await fetch(
      `${CMC_BASE}/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}&convert=USD`,
      {
        headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: Record<string, { quote?: { USD?: { price?: number; last_updated?: string } } }>;
    };
    const quote = body.data?.[symbol.toUpperCase()]?.quote?.USD;
    const price = Number(quote?.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    const at = quote?.last_updated ? Date.parse(quote.last_updated) : Date.now();
    return {
      source: "coinmarketcap",
      priceUsd: price,
      at: Number.isFinite(at) ? at : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Read the price from every configured source, in parallel.
 *
 * Returns whatever came back. The caller decides what to do with one reading,
 * two that agree, or two that do not.
 */
export async function fetchPriceReadings(symbol: string): Promise<PriceReading[]> {
  const results = await Promise.all([fetchCoinGeckoPrice(symbol), fetchCmcPrice(symbol)]);
  return results.filter((r): r is PriceReading => r !== null);
}

export function hasSecondPriceSource(): boolean {
  return Boolean(process.env.CMC_API_KEY?.trim());
}
