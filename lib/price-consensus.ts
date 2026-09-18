/**
 * Cross-checking a price claim against two independent sources.
 *
 * A market settled from one URL has one point of failure: if that page is
 * stale, wrong, or briefly serving garbage at the deadline, the oracle settles
 * confidently on bad data and somebody loses money to a typo.
 *
 * Two independent readings turn that into a detectable condition. If both
 * sources put the price on the same side of the threshold, the answer is not
 * in doubt and the verdict can carry more confidence than either source alone.
 * If they straddle it, the honest answer is that the market cannot be settled,
 * and the protocol already has a word for that: UNRESOLVABLE, which refunds
 * everyone rather than picking a winner by coin flip.
 */

export type PriceSourceId = "coingecko" | "coinmarketcap";

export interface PriceReading {
  source: PriceSourceId;
  priceUsd: number;
  /** ms epoch of the quote, as the source reports it. */
  at: number;
}

export type ConsensusVerdict =
  /** Both sources agree the price is above the threshold. */
  | "agree_above"
  /** Both sources agree the price is at or below the threshold. */
  | "agree_below"
  /** The sources land on opposite sides, or are too far apart to trust. */
  | "disagree"
  /** Fewer than two usable readings: fall back to the single source, no boost. */
  | "insufficient";

export interface ConsensusResult {
  verdict: ConsensusVerdict;
  readings: PriceReading[];
  /** Relative gap between the highest and lowest reading, 0 to 1. */
  spread: number;
  /** Why the sources were judged to disagree, when they were. */
  reason?: "straddles_threshold" | "spread_too_wide" | "stale_reading";
}

/**
 * Two sources this far apart are not measuring the same thing. Even when they
 * happen to land on the same side of the threshold, one of them is broken, and
 * settling on a number that might be the broken one is not worth the risk.
 */
export const MAX_SOURCE_SPREAD = 0.02;

/** A quote older than this is not evidence about the deadline. */
export const MAX_READING_AGE_MS = 15 * 60 * 1000;

/** Confidence added when two independent sources agree. */
export const AGREEMENT_CONFIDENCE_BONUS = 8;

function usable(reading: PriceReading, now: number): boolean {
  return (
    Number.isFinite(reading.priceUsd) &&
    reading.priceUsd > 0 &&
    Number.isFinite(reading.at) &&
    now - reading.at <= MAX_READING_AGE_MS
  );
}

export function crossCheckThreshold(
  readings: PriceReading[],
  threshold: number,
  now = Date.now(),
): ConsensusResult {
  const fresh = readings.filter((r) => usable(r, now));

  // One source can still settle a market; it just does not earn the bonus.
  if (fresh.length < 2 || !Number.isFinite(threshold) || threshold <= 0) {
    const stale = readings.length >= 2 && fresh.length < 2;
    return {
      verdict: "insufficient",
      readings: fresh,
      spread: 0,
      ...(stale ? { reason: "stale_reading" as const } : {}),
    };
  }

  const prices = fresh.map((r) => r.priceUsd);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const spread = high > 0 ? (high - low) / high : 0;

  if (spread > MAX_SOURCE_SPREAD) {
    return { verdict: "disagree", readings: fresh, spread, reason: "spread_too_wide" };
  }

  const allAbove = prices.every((p) => p > threshold);
  const allBelow = prices.every((p) => p <= threshold);

  if (allAbove) return { verdict: "agree_above", readings: fresh, spread };
  if (allBelow) return { verdict: "agree_below", readings: fresh, spread };

  return { verdict: "disagree", readings: fresh, spread, reason: "straddles_threshold" };
}

export interface SettlementAdjustment {
  /** True when the claim must settle as UNRESOLVABLE regardless of the model. */
  forceUnresolvable: boolean;
  /** Added to the oracle's confidence, capped at 100 by the caller. */
  confidenceDelta: number;
  /** One line for the settlement summary, so the reasoning is on chain. */
  note: string;
}

/**
 * Turn a consensus result into what the oracle should do about it.
 *
 * Disagreement is not a tie-break to be resolved by the model: the whole point
 * is that the data does not support a verdict, so no amount of reasoning over
 * it produces a trustworthy one.
 */
export function settlementAdjustment(result: ConsensusResult): SettlementAdjustment {
  const rendered = result.readings
    .map((r) => `${r.source} $${r.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
    .join(" vs ");

  switch (result.verdict) {
    case "agree_above":
    case "agree_below":
      return {
        forceUnresolvable: false,
        confidenceDelta: AGREEMENT_CONFIDENCE_BONUS,
        note: `Two independent sources agree (${rendered}).`,
      };
    case "disagree":
      return {
        forceUnresolvable: true,
        confidenceDelta: 0,
        note:
          result.reason === "spread_too_wide"
            ? `Sources disagree by ${(result.spread * 100).toFixed(2)}% (${rendered}); one of them is wrong, so the price cannot be settled.`
            : `Sources land on opposite sides of the threshold (${rendered}); the outcome is not determinable.`,
      };
    case "insufficient":
    default:
      return {
        forceUnresolvable: false,
        confidenceDelta: 0,
        note:
          result.reason === "stale_reading"
            ? "Only one fresh price source was available; settled without a cross-check."
            : "No second price source available; settled from the designated source alone.",
      };
  }
}

/**
 * Pull the USD thresholds a claim names.
 *
 * Shared with the market creator, which uses it to reject a drafted threshold
 * that is nowhere near the live price. The oracle uses it to know what number
 * the cross-check is actually about.
 */
export function extractUsdThresholds(text: string): number[] {
  const thresholds: number[] = [];
  const seen = new Set<number>();
  const patterns = [
    /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)(?:\s*([kKmMbBtT]))?/g,
    /\b([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:USD|US dollars?|dollars?)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = Number(match[1]?.replace(/,/g, ""));
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      const suffix = match[2]?.toLowerCase();
      const multiplier =
        suffix === "k" ? 1_000
        : suffix === "m" ? 1_000_000
        : suffix === "b" ? 1_000_000_000
        : suffix === "t" ? 1_000_000_000_000
        : 1;
      const value = parsed * multiplier;
      if (!seen.has(value)) {
        seen.add(value);
        thresholds.push(value);
      }
    }
  }

  return thresholds;
}

/**
 * Which asset a claim is about, if it names one this module can price.
 *
 * Deliberately narrow: a wrong symbol match would cross-check the claim against
 * an unrelated asset, which is worse than not cross-checking at all.
 */
const SYMBOL_PATTERNS: Array<{ symbol: string; pattern: RegExp }> = [
  { symbol: "BTC", pattern: /\b(btc|bitcoin)\b/i },
  { symbol: "ETH", pattern: /\b(eth|ethereum|ether)\b/i },
  { symbol: "SOL", pattern: /\b(sol|solana)\b/i },
  { symbol: "XRP", pattern: /\b(xrp|ripple)\b/i },
  { symbol: "DOGE", pattern: /\b(doge|dogecoin)\b/i },
  { symbol: "ADA", pattern: /\b(ada|cardano)\b/i },
  { symbol: "AVAX", pattern: /\b(avax|avalanche)\b/i },
  { symbol: "LINK", pattern: /\b(link|chainlink)\b/i },
  { symbol: "MATIC", pattern: /\b(matic|polygon)\b/i },
  { symbol: "DOT", pattern: /\b(dot|polkadot)\b/i },
];

export function detectAssetSymbol(text: string): string | null {
  const matches = SYMBOL_PATTERNS.filter((s) => s.pattern.test(text));
  // Two assets named means the claim is about a comparison this cannot price.
  return matches.length === 1 ? matches[0].symbol : null;
}

/**
 * Is this a claim a price cross-check can speak to at all?
 *
 * One asset and exactly one threshold. Anything else (a range, a spread between
 * two coins, a non-price question) falls back to the normal single-source path.
 */
export function priceCheckTarget(
  question: string,
  settlementRule = "",
): { symbol: string; threshold: number } | null {
  const text = `${question} ${settlementRule}`;
  const symbol = detectAssetSymbol(text);
  if (!symbol) return null;

  const thresholds = extractUsdThresholds(question);
  if (thresholds.length !== 1) return null;

  return { symbol, threshold: thresholds[0] };
}
