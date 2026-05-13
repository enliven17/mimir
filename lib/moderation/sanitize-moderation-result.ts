/**
 * Pure sanitization of LLM moderation JSON. Safe to import from Node tests (no `server-only`).
 */

export type ClaimModerationDecision = "allow" | "review" | "block";

export type ClaimModerationViolationCode =
  | "death_self_harm"
  | "violence_harm"
  | "hate_harassment"
  | "sexual_minors"
  | "nonconsensual_sexual"
  | "illegal_facilitation"
  | "doxxing_personal_data"
  | "medical_privacy"
  | "graphic_content"
  | "other_policy";

export type ClaimModerationResult = {
  decision: ClaimModerationDecision;
  violationCodes: ClaimModerationViolationCode[];
  confidence: number;
  policyVersion: string;
};

export type GeminiModerationPayload = {
  decision?: unknown;
  violationCodes?: unknown;
  confidence?: unknown;
};

function clampInt(value: unknown, min: number, max: number) {
  const raw =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  const n = Number.isFinite(raw) ? Math.round(raw) : min;
  return Math.max(min, Math.min(max, n));
}

function isDecision(value: unknown): value is ClaimModerationDecision {
  return value === "allow" || value === "review" || value === "block";
}

function isViolationCode(value: unknown): value is ClaimModerationViolationCode {
  return (
    value === "death_self_harm" ||
    value === "violence_harm" ||
    value === "hate_harassment" ||
    value === "sexual_minors" ||
    value === "nonconsensual_sexual" ||
    value === "illegal_facilitation" ||
    value === "doxxing_personal_data" ||
    value === "medical_privacy" ||
    value === "graphic_content" ||
    value === "other_policy"
  );
}

export function sanitizeModerationResult(args: {
  raw: GeminiModerationPayload;
  policyVersion: string;
  locale: string;
}): ClaimModerationResult {
  const decisionRaw = args.raw.decision;
  const decision: ClaimModerationDecision = isDecision(decisionRaw)
    ? decisionRaw
    : "review";

  const codes: ClaimModerationViolationCode[] = Array.isArray(
    args.raw.violationCodes
  )
    ? (args.raw.violationCodes as unknown[])
        .map((value) => (isViolationCode(value) ? value : null))
        .filter(Boolean)
        .slice(0, 5) as ClaimModerationViolationCode[]
    : [];

  const confidence = clampInt(args.raw.confidence, 0, 100);

  return {
    decision,
    violationCodes: decision === "allow" ? [] : codes,
    confidence,
    policyVersion: args.policyVersion,
  };
}
