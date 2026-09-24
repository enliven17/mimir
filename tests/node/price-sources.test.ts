import test from "node:test";
import assert from "node:assert/strict";

import { closestSample } from "../../lib/server/price-sources";

test("closestSample picks the sample nearest the target and skips junk", () => {
  const samples: Array<[number, number]> = [
    [1_000, 10],
    [2_000, 20],
    [2_600, NaN],
    [3_000, 30],
    [2_400, 0],
  ];
  assert.deepEqual(closestSample(samples, 2_450), [2_000, 20]);
  assert.deepEqual(closestSample(samples, 2_900), [3_000, 30]);
  assert.equal(closestSample([], 1), null);
});

test("lastRoundAtOrBefore finds the round that was current at the target time", async () => {
  const { lastRoundAtOrBefore } = await import("../../lib/server/chainlink");
  const times = [0, 100, 200, 300, 400, 500]; // index 1..5
  const at = async (i: number) => times[i];
  assert.equal(await lastRoundAtOrBefore(5, 250, at), 2);
  assert.equal(await lastRoundAtOrBefore(5, 500, at), 5);
  assert.equal(await lastRoundAtOrBefore(5, 99, at), -1);
  // A missing round (updatedAt 0) is never chosen.
  const gappy = async (i: number) => (i === 3 ? 0 : times[i]);
  assert.equal(await lastRoundAtOrBefore(5, 350, gappy), 2);
});
