import { normalizeResolutionSource } from "./constants";

export type ClaimStrengthTier = "strong" | "good" | "fair" | "weak";

export type ClaimQualitySignalKey =
  | "question_specific"
  | "positions_clear"
  | "source_present"
  | "settlement_specific"
  | "structured_category"
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

const CLAIM_QUALITY_WEIGHTS: Record<ClaimQualitySignalKey, number> = {
  question_specific: 20,
  positions_clear: 15,
  source_present: 25,
  settlement_specific: 20,
  structured_category: 10,
  sufficient_time: 10,
};

const SUFFICIENT_TIME_SECONDS = 6 * 60 * 60;

function normalizeComparableText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getClaimStrengthTier(score: number): ClaimStrengthTier {
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "weak";
}

export function computeClaimQuality(
  input: ClaimQualityInput,
  nowTs = Math.floor(Date.now() / 1000)
): ClaimQualityResult {
  const question = input.question.trim();
  const creatorPosition = normalizeComparableText(input.creator_position);
  const opponentPosition = normalizeComparableText(input.opponent_position);
  const settlementRule = input.settlement_rule.trim();
  const normalizedSource = normalizeResolutionSource(input.resolution_url);

  const signals: ClaimQualitySignal[] = [
    {
      key: "question_specific",
      passed: question.length >= 24,
    },
    {
      key: "positions_clear",
      passed:
        creatorPosition.length > 0 &&
        opponentPosition.length > 0 &&
        creatorPosition !== opponentPosition,
    },
    {
      key: "source_present",
      passed: normalizedSource.length > 0,
    },
    {
      key: "settlement_specific",
      passed: settlementRule.length >= 16,
    },
    {
      key: "structured_category",
      passed: input.category.trim().toLowerCase() !== "custom",
    },
    {
      key: "sufficient_time",
      passed:
        Number.isFinite(input.deadline) &&
        input.deadline - nowTs >= SUFFICIENT_TIME_SECONDS,
    },
  ];

  const score = signals.reduce((sum, signal) => {
    if (!signal.passed) {
      return sum;
    }
    return sum + CLAIM_QUALITY_WEIGHTS[signal.key];
  }, 0);

  return {
    score,
    tier: getClaimStrengthTier(score),
    signals,
  };
}
