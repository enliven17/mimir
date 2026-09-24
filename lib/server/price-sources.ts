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
import { CHAINLINK_FEEDS, fetchChainlinkPrice } from "./chainlink";

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

/** Window searched around a historical moment, each side. */
const HISTORY_WINDOW_MS = 30 * 60 * 1000;

/** The sample closest in time to `atMs`, or null when there is none. */
export function closestSample(samples: Array<[number, number]>, atMs: number): [number, number] | null {
  let best: [number, number] | null = null;
  for (const s of samples) {
    if (!Number.isFinite(s[0]) || !Number.isFinite(s[1]) || s[1] <= 0) continue;
    if (!best || Math.abs(s[0] - atMs) < Math.abs(best[0] - atMs)) best = s;
  }
  return best;
}

async function fetchCoinGeckoPriceAt(symbol: string, atMs: number): Promise<PriceReading | null> {
  const id = coingeckoIdFor(symbol);
  if (!id) return null;
  const from = Math.floor((atMs - HISTORY_WINDOW_MS) / 1000);
  const to = Math.ceil((atMs + HISTORY_WINDOW_MS) / 1000);
  try {
    const res = await fetch(
      `${COINGECKO_BASE}/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`,
      { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { prices?: Array<[number, number]> };
    const best = closestSample(body.prices ?? [], atMs);
    return best ? { source: "coingecko", priceUsd: best[1], at: best[0] } : null;
  } catch {
    return null;
  }
}

interface CmcHistoricalQuote {
  timestamp?: string;
  quote?: { USD?: { price?: number; timestamp?: string } };
}

/**
 * CMC historical quotes. Needs a CMC plan that includes historical data; on a
 * plan without it the call fails and the settlement proceeds on one source.
 */
async function fetchCmcPriceAt(symbol: string, atMs: number): Promise<PriceReading | null> {
  const key = process.env.CMC_API_KEY?.trim();
  if (!key) return null;
  const start = new Date(atMs - HISTORY_WINDOW_MS).toISOString();
  const end = new Date(atMs + HISTORY_WINDOW_MS).toISOString();
  try {
    const res = await fetch(
      `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/historical?symbol=${encodeURIComponent(symbol)}` +
        `&time_start=${encodeURIComponent(start)}&time_end=${encodeURIComponent(end)}&interval=5m&convert=USD`,
      {
        headers: { "X-CMC_PRO_API_KEY": key, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.warn(`[price-sources] CMC historical ${symbol} → HTTP ${res.status} (plan may not include historical quotes)`);
      return null;
    }
    const body = (await res.json()) as {
      data?: Record<string, Array<{ quotes?: CmcHistoricalQuote[] }> | { quotes?: CmcHistoricalQuote[] }>;
    };
    const entry = body.data?.[symbol.toUpperCase()];
    const quotes = (Array.isArray(entry) ? entry[0]?.quotes : entry?.quotes) ?? [];
    const samples = quotes.map((q): [number, number] => [
      Date.parse(q.quote?.USD?.timestamp ?? q.timestamp ?? ""),
      Number(q.quote?.USD?.price),
    ]);
    const best = closestSample(samples, atMs);
    return best ? { source: "coinmarketcap", priceUsd: best[1], at: best[0] } : null;
  } catch {
    return null;
  }
}

/**
 * Read the price from every configured source, in parallel.
 *
 * With `atMs` (a claim's deadline) far enough in the past, the sources are
 * asked for the price at that moment instead of now: a claim settled late must
 * be judged on the price at its deadline.
 *
 * Returns whatever came back. The caller decides what to do with one reading,
 * two that agree, or two that do not.
 */
export async function fetchPriceReadings(symbol: string, atMs?: number): Promise<PriceReading[]> {
  const historical = atMs !== undefined && Date.now() - atMs > 5 * 60 * 1000;
  const results = await Promise.all(
    historical
      ? [fetchCoinGeckoPriceAt(symbol, atMs), fetchCmcPriceAt(symbol, atMs), fetchChainlinkPrice(symbol, atMs)]
      : [fetchCoinGeckoPrice(symbol), fetchCmcPrice(symbol), fetchChainlinkPrice(symbol)],
  );
  return results.filter((r): r is PriceReading => r !== null);
}

/** CMC needs a key; Chainlink is keyless but only covers some assets. */
export function hasSecondPriceSource(symbol?: string): boolean {
  if (process.env.CMC_API_KEY?.trim()) return true;
  return symbol !== undefined && symbol.toUpperCase() in CHAINLINK_FEEDS;
}
