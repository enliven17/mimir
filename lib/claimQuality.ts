import { normalizeResolutionSource } from "./constants";

/**
 * How decidable a claim is.
 *
 * The earlier version of this scorer was a length checklist: a long enough
 * settlement rule and any URL scored "strong", so "Will it rain?" passed. What
 * actually determines whether a market can be settled without an argument is
 * different: the question has to name something checkable, the outcome has to
 * be a single thing rather than two joined by "and", the language has to avoid
 * words that two careful readers would score differently, and the source has to
 * be a page that answers the question rather than a homepage.
 *
 * These signals are what the oracle and the council will be up against at the
 * deadline, so they are the ones worth scoring at creation.
 */

export type ClaimStrengthTier = "strong" | "good" | "fair" | "weak";

export type ClaimQualitySignalKey =
  | "question_specific"
  | "question_decidable"
  | "positions_clear"
  | "objective_language"
  | "single_outcome"
  | "source_present"
  | "settlement_specific"
  | "sufficient_time";

export type ClaimQualityInput = {
  question: string;
  creator_position: string;
  opponent_position: string;
  resolution_url: string;
  settlement_rule: string;
  category: string;
  deadline: number;
};

export type ClaimQualitySignal = {
  key: ClaimQualitySignalKey;
  passed: boolean;
};

export type ClaimQualityResult = {
  score: number;
  tier: ClaimStrengthTier;
  signals: ClaimQualitySignal[];
};

/** Weights total 100. */
const CLAIM_QUALITY_WEIGHTS: Record<ClaimQualitySignalKey, number> = {
  question_specific: 10,
  question_decidable: 18,
  positions_clear: 10,
  objective_language: 12,
  single_outcome: 10,
  source_present: 15,
  settlement_specific: 15,
  sufficient_time: 10,
};

const SUFFICIENT_TIME_SECONDS = 6 * 60 * 60;
/** Past this horizon nobody can price the question and the market just sits. */
const MAX_HORIZON_SECONDS = 180 * 24 * 60 * 60;

const MIN_QUESTION_CHARS = 24;
const MAX_QUESTION_CHARS = 240;
const MIN_SETTLEMENT_CHARS = 40;

/** Highest score an undecidable question can reach: the top of the "weak" tier. */
const UNDECIDABLE_SCORE_CAP = 39;

/**
 * Words whose truth depends on the reader. A claim containing one of these is
 * not settleable from a source: two people reading the same page will disagree
 * about whether a move was "significant".
 */
const SUBJECTIVE_TERMS = [
  "significant",
  "significantly",
  "meaningful",
  "meaningfully",
  "substantial",
  "substantially",
  "major",
  "minor",
  "soon",
  "shortly",
  "reasonable",
  "reasonably",
  "popular",
  "successful",
  "success",
  "fail to impress",
  "well received",
  "well-received",
  "good",
  "bad",
  "better",
  "worse",
  "best",
  "worst",
  "strong",
  "weak",
  "many",
  "few",
  "several",
  "most people",
  "widely",
  "generally",
  "roughly",
  "approximately",
  "around the",
  "a lot",
  "huge",
  "massive",
  "dramatic",
  "dramatically",
];

/**
 * Hosts that cannot serve as a settlement source: the content moves, is
 * personalised, or is not reachable by a server-side fetch.
 */
const UNUSABLE_SOURCE_HOSTS = [
  "x.com",
  "twitter.com",
  "t.co",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com",
  "discord.com",
  "discord.gg",
  "t.me",
  "telegram.me",
  "youtube.com",
  "youtu.be",
  "google.com",
  "bing.com",
];

function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getClaimStrengthTier(score: number): ClaimStrengthTier {
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "weak";
}

/**
 * Does the question name something a reader could look up and check?
 *
 * A number, a threshold, a date, or an explicit comparison. "Will BTC close
 * above $100,000 on May 25?" has one; "Will BTC do well?" does not.
 */
function isDecidable(question: string): boolean {
  const q = question.toLowerCase();
  const hasNumber = /\d/.test(q);
  const hasComparison =
    /\b(above|below|over|under|at least|at most|more than|less than|exceed|reach|surpass|higher than|lower than|before|by the end of|on or before)\b/.test(
      q,
    );
  const hasNamedEvent =
    /\b(win|wins|beat|beats|defeat|defeats|announce|announces|launch|launches|release|releases|resign|resigns|approve|approves|qualify|qualifies|elected|confirmed)\b/.test(
      q,
    );
  // A number alone is not enough ("Will 2026 be a good year?"), and a bare verb
  // is not enough either. Two independent signals make it checkable.
  return [hasNumber, hasComparison, hasNamedEvent].filter(Boolean).length >= 2;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-bounded on purpose: padding with spaces misses a term followed by a full
 * stop, and a substring match would flag "goodwill" for containing "good".
 */
const SUBJECTIVE_PATTERN = new RegExp(
  `\\b(?:${SUBJECTIVE_TERMS.map(escapeRegExp).join("|")})\\b`,
  "i",
);

function usesObjectiveLanguage(question: string, settlementRule: string): boolean {
  const text = normalizeComparableText(`${question} ${settlementRule}`);
  if (text.length === 0) return false;
  return !SUBJECTIVE_PATTERN.test(text);
}

/**
 * One outcome, not two stapled together. "Will X launch and Y resign?" cannot
 * settle cleanly: half of it can be true.
 */
function isSingleOutcome(question: string): boolean {
  const q = normalizeComparableText(question);
  // An empty question is not "one outcome", it is no outcome.
  if (q.length === 0) return false;
  // "and" inside a name or a number range is fine; " and " joining two clauses
  // with their own verbs is not. Keep the heuristic conservative.
  const compound = / and (will|does|do|is|are|has|have|the .+ (will|does|is|are))/.test(q);
  const multiQuestion = (q.match(/\?/g) ?? []).length > 1;
  return !compound && !multiQuestion;
}

function isUsableSource(url: string): boolean {
  const normalized = normalizeResolutionSource(url);
  if (!normalized) return false;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (UNUSABLE_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return false;
  // A bare homepage rarely answers a specific question; a path or a query does.
  const hasDepth = parsed.pathname.replace(/\/+$/, "").length > 1 || parsed.search.length > 0;
  return hasDepth;
}

/** The rule has to say how to read the source at the deadline, not just exist. */
function isSettlementSpecific(rule: string, sourceUrl: string): boolean {
  const trimmed = rule.trim();
  if (trimmed.length < MIN_SETTLEMENT_CHARS) return false;
  const r = trimmed.toLowerCase();
  const mentionsSource =
    /\b(source|linked|page|url|feed|api|listed|published|reported|according to)\b/.test(r) ||
    (sourceUrl.length > 0 && r.includes(new URL(normalizeResolutionSource(sourceUrl) || "https://x").hostname.replace(/^www\./, "")));
  const mentionsTiming = /\b(deadline|at the close|closing|expiry|expires|as of|by |on or before|timestamp|utc)\b/.test(r);
  return mentionsSource && mentionsTiming;
}

export function computeClaimQuality(
  input: ClaimQualityInput,
  nowTs = Math.floor(Date.now() / 1000),
): ClaimQualityResult {
  const question = input.question.trim();
  const creatorPosition = normalizeComparableText(input.creator_position);
  const opponentPosition = normalizeComparableText(input.opponent_position);
  const settlementRule = input.settlement_rule.trim();

  const horizon = input.deadline - nowTs;

  const signals: ClaimQualitySignal[] = [
    {
      key: "question_specific",
      passed:
        question.length >= MIN_QUESTION_CHARS &&
        question.length <= MAX_QUESTION_CHARS &&
        question.includes("?"),
    },
    {
      key: "question_decidable",
      passed: isDecidable(question),
    },
    {
      key: "positions_clear",
      passed:
        creatorPosition.length > 0 &&
        opponentPosition.length > 0 &&
        creatorPosition !== opponentPosition,
    },
    {
      key: "objective_language",
      passed: usesObjectiveLanguage(question, settlementRule),
    },
    {
      key: "single_outcome",
      passed: isSingleOutcome(question),
    },
    {
      key: "source_present",
      passed: isUsableSource(input.resolution_url),
    },
    {
      key: "settlement_specific",
      passed: isSettlementSpecific(settlementRule, input.resolution_url),
    },
    {
      key: "sufficient_time",
      passed:
        Number.isFinite(input.deadline) &&
        horizon >= SUFFICIENT_TIME_SECONDS &&
        horizon <= MAX_HORIZON_SECONDS,
    },
  ];

  const raw = signals.reduce(
    (sum, signal) => (signal.passed ? sum + CLAIM_QUALITY_WEIGHTS[signal.key] : sum),
    0,
  );

  // Decidability is a gate, not a weight. A question nobody can check does not
  // become settleable because the rest of the form was filled in nicely, and
  // letting it reach "good" is exactly how an unsettleable market gets opened.
  const decidable = signals.find((s) => s.key === "question_decidable")?.passed ?? false;
  const score = decidable ? raw : Math.min(raw, UNDECIDABLE_SCORE_CAP);

  return { score, tier: getClaimStrengthTier(score), signals };
}
