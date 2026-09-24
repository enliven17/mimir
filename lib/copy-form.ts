/**
 * Client side of granting a copy permission.
 *
 * The follower signs `copyPermissionMessage(draft)` and the server rebuilds the
 * draft from the POST body before verifying. If the two drafts differ by one
 * character the signature fails, so `buildCopyDraft` mirrors the parsing in
 * `app/api/copy/permissions/route.ts` field for field, and the body we POST is
 * derived from the very draft that was signed.
 */

import {
  InvalidCopyPermissionError,
  validateCopyPermission,
  type CopyPermission,
} from "./copy-trading";

export type CopyDraft = Omit<CopyPermission, "signature" | "createdAt">;

export const COPY_CATEGORIES = ["sports", "weather", "crypto", "culture", "custom"] as const;
export type CopyCategory = (typeof COPY_CATEGORIES)[number];

/** Same pattern the POST handler enforces. */
export const COPY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Raw form values: everything a text input produces is a string. */
export interface CopyFormValues {
  id: string;
  signalAgentId: string;
  executionAgentId: string;
  maxPerPositionUsdc: string;
  maxDailyUsdc: string;
  maxWeeklyUsdc: string;
  maxOpenExposureUsdc: string;
  maxRealizedLossUsdc: string;
  allowedCategories: CopyCategory[];
  minClaimQuality: string;
  minPayoutRatio: string;
  /** `YYYY-MM-DD` from a date input. */
  expiresOn: string;
}

export const DEFAULT_COPY_FORM: CopyFormValues = {
  id: "",
  signalAgentId: "",
  executionAgentId: "",
  maxPerPositionUsdc: "2",
  maxDailyUsdc: "10",
  maxWeeklyUsdc: "40",
  maxOpenExposureUsdc: "20",
  maxRealizedLossUsdc: "10",
  allowedCategories: [],
  minClaimQuality: "60",
  minPayoutRatio: "1.2",
  expiresOn: "",
};

function numberOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** The permission ends at the last second of the chosen day, local time. */
export function expiresAtFromDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
  const ms = new Date(`${date}T23:59:59`).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** `YYYY-MM-DD` for a date `days` from `now`, local time (date input format). */
export function dateInputValue(now: number, days: number): string {
  const d = new Date(now + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A readable, valid permission id: "copy-statistician-via-my-agent-k3x9".
 * The suffix keeps a second grant for the same pair from overwriting the first.
 */
export function suggestCopyId(signalAgentId: string, executionAgentId: string, suffix: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const tail = slug(suffix) || "0";
  const parts = ["copy", slug(signalAgentId), "via", slug(executionAgentId)].filter(Boolean);
  const head = parts.join("-").slice(0, 63 - tail.length - 1).replace(/-+$/, "");
  return `${head}-${tail}`;
}

export function buildCopyDraft(values: CopyFormValues, follower: string): CopyDraft {
  return {
    id: values.id.trim(),
    follower: follower.toLowerCase(),
    signalAgentId: values.signalAgentId.trim(),
    executionAgentId: values.executionAgentId.trim(),
    active: true,
    expiresAt: expiresAtFromDate(values.expiresOn),
    maxPerPositionUsdc: numberOr(values.maxPerPositionUsdc, 0),
    maxDailyUsdc: numberOr(values.maxDailyUsdc, 0),
    maxWeeklyUsdc: numberOr(values.maxWeeklyUsdc, 0),
    maxOpenExposureUsdc: numberOr(values.maxOpenExposureUsdc, 0),
    maxRealizedLossUsdc: numberOr(values.maxRealizedLossUsdc, 0),
    // Keep the checkbox order stable so the signed text does not depend on click order.
    allowedCategories: COPY_CATEGORIES.filter((c) => values.allowedCategories.includes(c)),
    allowedModes: [],
    minClaimQuality: numberOr(values.minClaimQuality, 0),
    minPayoutRatio: numberOr(values.minPayoutRatio, 1),
  };
}

/** The first problem the server would reject the draft for, or null. */
export function copyDraftError(draft: CopyDraft, now = Date.now()): string | null {
  if (!COPY_ID_PATTERN.test(draft.id)) {
    return "id must be 3-64 chars of [a-z0-9-], starting alphanumeric";
  }
  try {
    validateCopyPermission({ ...draft, signature: "", createdAt: now }, now);
    return null;
  } catch (err) {
    if (err instanceof InvalidCopyPermissionError) return err.message;
    throw err;
  }
}

/** The POST body for a signed draft. */
export function copyGrantBody(draft: CopyDraft, signature: string): Record<string, unknown> {
  return { ...draft, signature };
}
