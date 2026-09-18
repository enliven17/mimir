import test from "node:test";
import assert from "node:assert/strict";

import {
  gradeHeartbeat,
  worstSeverity,
  healthHttpStatus,
  LATE_INTERVALS,
  DEAD_INTERVALS,
} from "../../lib/ops/health";
import type { Heartbeat } from "../../lib/ops/heartbeat";

const NOW = 1_700_000_000_000;
const hb = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  worker: "oracle",
  at: NOW,
  intervalSec: 60,
  ok: true,
  ...over,
});

test("a worker that never reported is critical", () => {
  const a = gradeHeartbeat("oracle", null, NOW);
  assert.equal(a.severity, "critical");
  assert.equal(a.ageSec, null);
});

test("a fresh successful heartbeat is ok", () => {
  assert.equal(gradeHeartbeat("oracle", hb(), NOW).severity, "ok");
});

test("a failed last cycle warns but does not page", () => {
  const a = gradeHeartbeat("oracle", hb({ ok: false, error: "rpc timeout" }), NOW);
  assert.equal(a.severity, "warn");
  assert.equal(a.reason, "rpc timeout");
});

test("lateness escalates from ok to warn to critical", () => {
  const at = (sec: number) => hb({ at: NOW - sec * 1000 });
  assert.equal(gradeHeartbeat("oracle", at(60), NOW).severity, "ok");
  assert.equal(gradeHeartbeat("oracle", at(60 * LATE_INTERVALS + 1), NOW).severity, "warn");
  assert.equal(gradeHeartbeat("oracle", at(60 * DEAD_INTERVALS + 1), NOW).severity, "critical");
});

test("a clock skew into the future does not produce a negative age", () => {
  assert.equal(gradeHeartbeat("oracle", hb({ at: NOW + 5_000 }), NOW).ageSec, 0);
});

test("the report takes the worst severity and only critical returns 503", () => {
  assert.equal(worstSeverity([]), "ok");
  assert.equal(
    worstSeverity([
      { worker: "oracle", severity: "ok", reason: "", ageSec: 1 },
      { worker: "council", severity: "warn", reason: "", ageSec: 1 },
    ]),
    "warn",
  );
  assert.equal(
    worstSeverity([
      { worker: "oracle", severity: "warn", reason: "", ageSec: 1 },
      { worker: "council", severity: "critical", reason: "", ageSec: 1 },
    ]),
    "critical",
  );
  assert.equal(healthHttpStatus("ok"), 200);
  assert.equal(healthHttpStatus("warn"), 200);
  assert.equal(healthHttpStatus("critical"), 503);
});
