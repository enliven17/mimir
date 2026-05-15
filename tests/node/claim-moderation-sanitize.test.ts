import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeModerationResult } from "../../lib/moderation/sanitize-moderation-result";

const BASE = {
  policyVersion: "policy-md:v1",
  locale: "en",
};

test("sanitizeModerationResult: invalid decision defaults to review", () => {
  const out = sanitizeModerationResult({
    raw: { decision: "ban", violationCodes: ["violence_harm"], confidence: 50 },
    ...BASE,
  });
  assert.equal(out.decision, "review");
  assert.deepEqual(out.violationCodes, ["violence_harm"]);
});

test("sanitizeModerationResult: allow strips violation codes", () => {
  const out = sanitizeModerationResult({
    raw: {
      decision: "allow",
      violationCodes: ["death_self_harm", "other_policy"],
      confidence: 90,
    },
    ...BASE,
  });
  assert.equal(out.decision, "allow");
  assert.deepEqual(out.violationCodes, []);
});

test("sanitizeModerationResult: clamps confidence to 0–100", () => {
  assert.equal(
    sanitizeModerationResult({
      raw: { decision: "block", violationCodes: [], confidence: -5 },
      ...BASE,
    }).confidence,
    0
  );
  assert.equal(
    sanitizeModerationResult({
      raw: { decision: "block", violationCodes: [], confidence: 150 },
      ...BASE,
    }).confidence,
    100
  );
  assert.equal(
    sanitizeModerationResult({
      raw: { decision: "review", violationCodes: [], confidence: 42.7 },
      ...BASE,
    }).confidence,
    43
  );
});

test("sanitizeModerationResult: non-finite confidence becomes 0", () => {
  assert.equal(
    sanitizeModerationResult({
      raw: { decision: "review", violationCodes: [], confidence: Number.NaN },
      ...BASE,
    }).confidence,
    0
  );
});

test("sanitizeModerationResult: drops unknown violation codes and caps at 5", () => {
  const out = sanitizeModerationResult({
    raw: {
      decision: "block",
      violationCodes: [
        "death_self_harm",
        "not_a_real_code",
        "violence_harm",
        "hate_harassment",
        "sexual_minors",
        "nonconsensual_sexual",
        "illegal_facilitation",
      ],
      confidence: 100,
    },
    ...BASE,
  });
  assert.deepEqual(out.violationCodes, [
    "death_self_harm",
    "violence_harm",
    "hate_harassment",
    "sexual_minors",
    "nonconsensual_sexual",
  ]);
});

test("sanitizeModerationResult: missing violationCodes becomes empty array for non-allow", () => {
  const out = sanitizeModerationResult({
    raw: { decision: "review", confidence: 10 },
    ...BASE,
  });
  assert.deepEqual(out.violationCodes, []);
});

test("sanitizeModerationResult: non-array violationCodes becomes empty", () => {
  const out = sanitizeModerationResult({
    raw: {
      decision: "review",
      violationCodes: "death_self_harm" as unknown as string[],
      confidence: 10,
    },
    ...BASE,
  });
  assert.deepEqual(out.violationCodes, []);
});

test("sanitizeModerationResult: preserves policyVersion", () => {
  const out = sanitizeModerationResult({
    raw: { decision: "allow", confidence: 0 },
    policyVersion: "custom:v9",
    locale: "es",
  });
  assert.equal(out.policyVersion, "custom:v9");
});
