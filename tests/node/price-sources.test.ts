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
