import test from "node:test";
import assert from "node:assert/strict";

import { calibrate, probabilityFromVerdict } from "../../lib/calibration";

test("verdicts map to a probability that the challengers win", () => {
  assert.equal(probabilityFromVerdict("CHALLENGERS_WIN", 80), 0.9);
  assert.ok(Math.abs(probabilityFromVerdict("CREATOR_WINS", 80) - 0.1) < 1e-9);
  assert.equal(probabilityFromVerdict("UNRESOLVABLE", 90), 0.5);
});

test("Brier scores rank forecasters and skip unscored outcomes", () => {
  const rows = calibrate([
    { forecaster: "sharp", pChallengers: 0.9, winnerSide: "challengers" },
    { forecaster: "sharp", pChallengers: 0.1, winnerSide: "creator" },
    { forecaster: "coin", pChallengers: 0.5, winnerSide: "creator" },
    { forecaster: "wrong", pChallengers: 0.9, winnerSide: "creator" },
    { forecaster: "sharp", pChallengers: 0.9, winnerSide: "unresolvable" },
  ]);
  assert.deepEqual(rows.map((r) => r.forecaster), ["sharp", "coin", "wrong"]);
  assert.equal(rows[0].forecasts, 2);
  assert.ok(Math.abs(rows[0].brier - 0.01) < 1e-9);
  assert.equal(rows[0].hitRate, 1);
  assert.equal(rows[1].brier, 0.25);
  assert.equal(rows[1].hitRate, 0, "a 50/50 call leans nowhere");
});
