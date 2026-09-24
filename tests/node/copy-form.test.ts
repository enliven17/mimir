import test from "node:test";
import assert from "node:assert/strict";

import {
  COPY_ID_PATTERN,
  DEFAULT_COPY_FORM,
  buildCopyDraft,
  copyDraftError,
  copyGrantBody,
  expiresAtFromDate,
  suggestCopyId,
  type CopyFormValues,
} from "../../lib/copy-form";
import { copyPermissionMessage } from "../../lib/copy-trading";

const FOLLOWER = "0xABCDEF0000000000000000000000000000000001";
const NOW = new Date("2026-01-10T12:00:00").getTime();

function form(over: Partial<CopyFormValues> = {}): CopyFormValues {
  return {
    ...DEFAULT_COPY_FORM,
    id: "copy-stat-via-exec-abc",
    signalAgentId: "statistician",
    executionAgentId: "my-agent",
    expiresOn: "2026-02-01",
    ...over,
  };
}

/** The same parsing the POST handler applies to its JSON body. */
function serverDraft(body: Record<string, unknown>) {
  const numberOr = (v: unknown, f: number) => (Number.isFinite(Number(v)) ? Number(v) : f);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    id: String(body.id ?? "").trim(),
    follower: String(body.follower).toLowerCase(),
    signalAgentId: String(body.signalAgentId ?? "").trim(),
    executionAgentId: String(body.executionAgentId ?? "").trim(),
    active: true,
    expiresAt: numberOr(body.expiresAt, 0),
    maxPerPositionUsdc: numberOr(body.maxPerPositionUsdc, 0),
    maxDailyUsdc: numberOr(body.maxDailyUsdc, 0),
    maxWeeklyUsdc: numberOr(body.maxWeeklyUsdc, 0),
    maxOpenExposureUsdc: numberOr(body.maxOpenExposureUsdc, 0),
    maxRealizedLossUsdc: numberOr(body.maxRealizedLossUsdc, 0),
    allowedCategories: list(body.allowedCategories),
    allowedModes: list(body.allowedModes),
    minClaimQuality: numberOr(body.minClaimQuality, 0),
    minPayoutRatio: numberOr(body.minPayoutRatio, 1),
  };
}

test("the POSTed body rebuilds to the exact message that was signed", () => {
  const draft = buildCopyDraft(form({ allowedCategories: ["crypto", "sports"] }), FOLLOWER);
  const body = JSON.parse(JSON.stringify(copyGrantBody(draft, "0xsig")));
  assert.equal(copyPermissionMessage(serverDraft(body)), copyPermissionMessage(draft));
  assert.equal(body.signature, "0xsig");
});

test("categories are ordered canonically, not by click order", () => {
  const draft = buildCopyDraft(form({ allowedCategories: ["custom", "sports"] }), FOLLOWER);
  assert.deepEqual(draft.allowedCategories, ["sports", "custom"]);
});

test("the follower is lowercased like normalizeAddress", () => {
  assert.equal(buildCopyDraft(form(), FOLLOWER).follower, FOLLOWER.toLowerCase());
});

test("expiry is the end of the chosen local day, and junk is 0", () => {
  assert.equal(expiresAtFromDate("2026-02-01"), new Date("2026-02-01T23:59:59").getTime());
  assert.equal(expiresAtFromDate(""), 0);
  assert.equal(expiresAtFromDate("tomorrow"), 0);
});

test("client validation reports what the server would reject", () => {
  assert.equal(copyDraftError(buildCopyDraft(form(), FOLLOWER), NOW), null);
  assert.match(copyDraftError(buildCopyDraft(form({ id: "X" }), FOLLOWER), NOW) ?? "", /id must be/);
  assert.match(
    copyDraftError(buildCopyDraft(form({ executionAgentId: "statistician" }), FOLLOWER), NOW) ?? "",
    /both the signal and the executor/,
  );
  assert.match(copyDraftError(buildCopyDraft(form({ expiresOn: "" }), FOLLOWER), NOW) ?? "", /expire in the future/);
  assert.match(
    copyDraftError(buildCopyDraft(form({ maxPerPositionUsdc: "50" }), FOLLOWER), NOW) ?? "",
    /exceed the daily cap/,
  );
  assert.match(copyDraftError(buildCopyDraft(form({ minPayoutRatio: "0.9" }), FOLLOWER), NOW) ?? "", /guaranteed loss/);
});

test("suggested ids always satisfy the server pattern", () => {
  const cases: Array<[string, string, string]> = [
    ["statistician", "my-agent", "k3x9"],
    ["Weird Name!!", "__exec__", "1"],
    ["", "", ""],
    ["a".repeat(80), "b".repeat(80), "zz"],
  ];
  for (const [s, e, suffix] of cases) {
    const id = suggestCopyId(s, e, suffix);
    assert.ok(COPY_ID_PATTERN.test(id), `${id} should be valid`);
  }
  assert.equal(suggestCopyId("statistician", "my-agent", "k3x9"), "copy-statistician-via-my-agent-k3x9");
});
