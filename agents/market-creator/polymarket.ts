/**
 * Polymarket as a candidate source.
 *
 * LLM-drafted questions are the weak link in the market creator: the model
 * invents a threshold, and it turns out to be one nobody can check. Polymarket's
 * live book is the opposite: every question there is already written to be
 * settleable, already has a resolution date, and already has real money pricing
 * it, which is a far better signal of whether a question is worth asking than
 * anything a drafting prompt can produce.
 *
 * What is borrowed is the *question*, not the market. Mimir opens its own claim,
 * with its own stake, settled by its own oracle reading the linked page. The
 * Polymarket price is used only to skip questions that are already decided: a
 * market trading at 97% is not a bet, it is a formality.
 */

export interface PolymarketCandidate {
  question: string;
  /** The public market page, used as the settlement source. */
  url: string;
  /** Probability of "yes", 0 to 1, as the book currently prices it. */
  probability: number;
  /** ms epoch. */
  endDate: number;
  liquidityUsd: number;
  volumeUsd: number;
  category: string;
}

const GAMMA_BASE = "https://gamma-api.polymarket.com";

/** Questions this crowded are settled in all but name. */
export const MAX_PROBABILITY = 0.9;
export const MIN_PROBABILITY = 0.1;

/** Below this there is no crowd, so the question carries no signal. */
export const MIN_LIQUIDITY_USD = 5_000;

/** A market resolving inside this window cannot be challenged in time. */
export const MIN_HOURS_TO_END = 12;
/** Past this, nobody can price it and the claim just sits open. */
export const MAX_HOURS_TO_END = 90 * 24;

interface RawMarket {
  question?: unknown;
  slug?: unknown;
  endDate?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidityNum?: unknown;
  volumeNum?: unknown;
  closed?: unknown;
  active?: unknown;
  archived?: unknown;
  category?: unknown;
}

/** Gamma returns these as JSON-encoded strings, not arrays. */
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Turn one raw Gamma market into a candidate, or null.
 *
 * Exported so the filtering can be tested against recorded payloads without a
 * network: the shape of this API is not something to discover in production.
 */
export function toCandidate(raw: RawMarket, now = Date.now()): PolymarketCandidate | null {
  if (raw.closed === true || raw.archived === true || raw.active === false) return null;

  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  const slug = typeof raw.slug === "string" ? raw.slug.trim() : "";
  if (!question || !slug) return null;

  // Binary only. A multi-outcome market does not map onto a two-sided claim.
  const outcomes = parseStringArray(raw.outcomes).map((o) => o.toLowerCase());
  if (outcomes.length !== 2) return null;
  const yesIndex = outcomes.indexOf("yes");
  if (yesIndex === -1) return null;

  const prices = parseStringArray(raw.outcomePrices).map(Number);
  if (prices.length !== 2 || prices.some((p) => !Number.isFinite(p))) return null;
  const probability = prices[yesIndex];
  if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) return null;

  const endDate = raw.endDate ? Date.parse(String(raw.endDate)) : NaN;
  if (!Number.isFinite(endDate)) return null;
  const hoursOut = (endDate - now) / 3_600_000;
  if (hoursOut < MIN_HOURS_TO_END || hoursOut > MAX_HOURS_TO_END) return null;

  const liquidityUsd = num(raw.liquidityNum);
  if (liquidityUsd < MIN_LIQUIDITY_USD) return null;

  return {
    question,
    url: `https://polymarket.com/market/${slug}`,
    probability,
    endDate,
    liquidityUsd,
    volumeUsd: num(raw.volumeNum),
    category: typeof raw.category === "string" && raw.category ? raw.category : "custom",
  };
}

/**
 * Rank what is left.
 *
 * Closeness to even money first: a question the crowd cannot agree on is the
 * one worth putting in front of people. Liquidity breaks ties, because a
 * contested question nobody has money on is usually just an unclear one.
 */
export function rankCandidates(candidates: PolymarketCandidate[]): PolymarketCandidate[] {
  return [...candidates].sort((a, b) => {
    const aBalance = Math.abs(a.probability - 0.5);
    const bBalance = Math.abs(b.probability - 0.5);
    if (Math.abs(aBalance - bBalance) > 0.02) return aBalance - bBalance;
    return b.liquidityUsd - a.liquidityUsd;
  });
}

export function isPolymarketEnabled(): boolean {
  const raw = process.env.MARKET_CREATOR_POLYMARKET?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Fetch open binary markets worth borrowing a question from.
 *
 * Fails soft: the market creator has other sources, and a source being down is
 * not a reason to skip a whole run.
 */
export async function fetchPolymarketCandidates(limit = 12): Promise<PolymarketCandidate[]> {
  const url =
    `${GAMMA_BASE}/markets?closed=false&archived=false&active=true` +
    `&limit=120&order=liquidityNum&ascending=false`;

  let raw: RawMarket[];
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[market-creator] polymarket returned HTTP ${res.status}`);
      return [];
    }
    const body = await res.json();
    raw = Array.isArray(body) ? body : [];
  } catch (err) {
    console.warn(
      "[market-creator] polymarket fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }

  const now = Date.now();
  const candidates = raw
    .map((m) => toCandidate(m, now))
    .filter((c): c is PolymarketCandidate => c !== null);

  return rankCandidates(candidates).slice(0, limit);
}

/**
 * Render candidates for the drafting prompt.
 *
 * The price is included so the model can see how contested a question is, and
 * the instruction is explicit that the question is to be restated for Mimir's
 * own settlement rather than copied with its Polymarket framing intact.
 */
export function formatPolymarketPrompt(candidates: PolymarketCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) => {
    const days = Math.round((c.endDate - Date.now()) / 86_400_000);
    return (
      `- "${c.question}" | crowd: ${(c.probability * 100).toFixed(0)}% yes | ` +
      `resolves in ~${days}d | liquidity $${Math.round(c.liquidityUsd).toLocaleString("en-US")} | ${c.url}`
    );
  });
  return [
    "LIVE PREDICTION MARKETS (questions already written to be settleable, with real money pricing them):",
    ...lines,
    "",
    "Use these as subject matter, not as text to copy. Restate each one as a Mimir claim with its own",
    "explicit settlement rule and the linked page as the resolution source. Prefer the ones closest to",
    "50/50. Do not invent a threshold the linked page cannot answer.",
  ].join("\n");
}
