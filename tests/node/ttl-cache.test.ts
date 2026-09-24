import test from "node:test";
import assert from "node:assert/strict";

import { cachedFor } from "../../lib/server/ttl-cache";

test("cachedFor dedupes within the TTL but does not cache failures", async () => {
  let calls = 0;
  let fail = true;
  const fn = cachedFor(async (x: number) => {
    calls++;
    if (fail) throw new Error("boom");
    return x * 2;
  }, 60_000);

  await assert.rejects(fn(2));
  await new Promise((r) => setImmediate(r));
  fail = false;
  assert.equal(await fn(2), 4, "a failure is retried, not served for the TTL");
  assert.equal(await fn(2), 4);
  assert.equal(calls, 2);
});
