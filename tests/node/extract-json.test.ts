import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "../../lib/llm";

test("extracts first balanced object, ignoring trailing prose (Gemma case)", () => {
  const out = extractJson('Sure! {"verdict":"DRAW","confidence":50} — hope that helps {extra}');
  assert.equal(out, '{"verdict":"DRAW","confidence":50}');
});

test("ignores braces inside strings", () => {
  const out = extractJson('{"note":"use { and } carefully","ok":true} junk');
  assert.deepEqual(JSON.parse(out!), { note: "use { and } carefully", ok: true });
});

test("strips code fences", () => {
  const out = extractJson('```json\n{"a":1}\n```');
  assert.equal(out, '{"a":1}');
});

test("array mode with nested objects", () => {
  const out = extractJson('here: [{"id":1},{"id":2}] done', "[");
  assert.deepEqual(JSON.parse(out!), [{ id: 1 }, { id: 2 }]);
});

test("returns null when no JSON present", () => {
  assert.equal(extractJson("no json here"), null);
});
