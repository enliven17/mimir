import assert from "node:assert/strict";
import test from "node:test";

import { draftOutcomeSidesFromQuestion } from "../../lib/outcomeDraft";

test("statement with auxiliary splits into positive/negative sides", () => {
  const draft = draftOutcomeSidesFromQuestion("Pizza is the best food?", "en");
  assert.deepEqual(draft, {
    creator: "Pizza is the best food",
    opponent: "Pizza is not the best food",
  });
});

test("weather questions use the No-<phenomenon> form", () => {
  const draft = draftOutcomeSidesFromQuestion("Will it rain in Paris?", "en");
  assert.deepEqual(draft, {
    creator: "Rain in Paris",
    opponent: "No rain in Paris",
  });
});

test("unparseable input falls back to Yes/No prefixes", () => {
  const draft = draftOutcomeSidesFromQuestion("moon soon", "en");
  assert.deepEqual(draft, {
    creator: "Yes - Moon soon",
    opponent: "No - Moon soon",
  });
});

test("Spanish locale uses the Si prefix in the fallback", () => {
  const draft = draftOutcomeSidesFromQuestion("luna pronto", "es");
  assert.equal(draft?.creator.startsWith("Si - "), true);
});

test("empty question returns null", () => {
  assert.equal(draftOutcomeSidesFromQuestion("", "en"), null);
  assert.equal(draftOutcomeSidesFromQuestion("???", "en"), null);
});
