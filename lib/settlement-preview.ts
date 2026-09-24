/**
 * What the oracle will do with a claim, in plain steps, before anyone stakes;
 * and how firm its verdict was, after.
 *
 * Mirrors the oracle's decision order (agents/oracle/index.ts decide()), so the
 * preview is a promise the settlement code actually keeps. Pure.
 */
import { priceCheckTarget } from "./price-consensus";
import { parseResolverSpec } from "./resolver-spec";

export type SettlementMethod = "resolver-price" | "resolver-json" | "price-consensus" | "evidence-llm";

export interface SettlementPreview {
  method: SettlementMethod;
  steps: string[];
  /** Settlement waits past the deadline for a final result. */
  waitsForFinal: "sports" | "polymarket" | null;
}

export type ConfidenceTier = "deterministic" | "firm" | "contested" | "refunded";

export interface PreviewInput {
  question: string;
  settlementRule?: string;
  resolutionUrl: string;
  category: string;
  deadline: number;
}

function isPolymarket(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "polymarket.com" || host.endsWith(".polymarket.com");
  } catch {
    return false;
  }
}

export function settlementPreview(c: PreviewInput): SettlementPreview {
  const spec = parseResolverSpec(c.settlementRule);
  const price = priceCheckTarget(c.question, c.settlementRule ?? "");
  const deadline = new Date(c.deadline * 1000).toISOString().replace(".000Z", "Z");
  const waitsForFinal = c.category.toLowerCase() === "sports" ? "sports" : isPolymarket(c.resolutionUrl) ? "polymarket" : null;
  const steps: string[] = [];

  if (waitsForFinal === "sports") steps.push("Waits for the match to be final (up to 12h after the deadline), then settles.");
  if (waitsForFinal === "polymarket") steps.push("Waits for the Polymarket market to be resolved by UMA (up to 72h), then settles.");

  let method: SettlementMethod;
  if (spec?.kind === "price") {
    method = "resolver-price";
    steps.push(`Reads ${spec.symbol}/USD at ${deadline} from CoinGecko, CoinMarketCap and Chainlink.`);
    steps.push(`YES if every source shows ${spec.symbol} ${spec.op} $${spec.threshold.toLocaleString("en-US")}; sources that disagree mean a refund.`);
    steps.push("No AI model is involved unless the price sources cannot answer.");
  } else if (spec?.kind === "json") {
    method = "resolver-json";
    steps.push(`Reads ${spec.path} from ${spec.url} after the deadline.`);
    steps.push(`YES if it is ${spec.op} ${JSON.stringify(spec.value)}. No AI model is involved unless the source cannot be read.`);
  } else if (price) {
    method = "price-consensus";
    steps.push(`Reads the resolution source, plus ${price.symbol}/USD at ${deadline} from independent price feeds.`);
    steps.push("An AI oracle judges the evidence; if the price feeds disagree with each other or with the model, everyone is refunded.");
  } else {
    method = "evidence-llm";
    steps.push("Reads the resolution source after the deadline.");
    steps.push("An AI oracle judges the evidence against the settlement rule.");
  }
  steps.push("Below 60% confidence, or with no readable evidence, every stake is refunded instead of guessed.");
  steps.push("Every verdict publishes an audit record whose hash is stored on chain.");
  return { method, steps, waitsForFinal };
}

/** How firm a settled verdict was, from what the oracle wrote on chain. */
export function confidenceTier(winnerSide: string | undefined, confidence: number | undefined, summary: string): ConfidenceTier {
  if (winnerSide === "draw" || winnerSide === "unresolvable" || /refunded/i.test(summary)) return "refunded";
  if (summary.startsWith("[RESOLVER]")) return "deterministic";
  if (/\[CONTESTED\]/.test(summary) || (confidence ?? 0) < 80) return "contested";
  return "firm";
}
