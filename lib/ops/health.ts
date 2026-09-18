/**
 * Health evaluation for the ops probe.
 *
 * Reads worker heartbeats and turns them into alarms. Kept pure apart from the
 * heartbeat read so the grading rules can be tested directly.
 */
import { MONITORED_WORKERS, readHeartbeat, type Heartbeat, type WorkerName } from "./heartbeat";

export type Severity = "ok" | "warn" | "critical";

export interface Alarm {
  worker: WorkerName;
  severity: Severity;
  reason: string;
  /** Seconds since the last heartbeat, null when the worker never reported. */
  ageSec: number | null;
}

export interface HealthReport {
  status: Severity;
  at: number;
  alarms: Alarm[];
}

/** A worker is late after two missed intervals, critical after four. */
export const LATE_INTERVALS = 2;
export const DEAD_INTERVALS = 4;

export function gradeHeartbeat(
  worker: WorkerName,
  hb: Heartbeat | null,
  now: number,
): Alarm {
  if (!hb) {
    return { worker, severity: "critical", reason: "no heartbeat recorded", ageSec: null };
  }
  const ageSec = Math.max(0, Math.round((now - hb.at) / 1000));
  const interval = Math.max(1, hb.intervalSec);
  if (ageSec > interval * DEAD_INTERVALS) {
    return { worker, severity: "critical", reason: `silent for ${ageSec}s`, ageSec };
  }
  if (ageSec > interval * LATE_INTERVALS) {
    return { worker, severity: "warn", reason: `late by ${ageSec - interval}s`, ageSec };
  }
  if (!hb.ok) {
    return { worker, severity: "warn", reason: hb.error ?? "last cycle failed", ageSec };
  }
  return { worker, severity: "ok", reason: "reporting", ageSec };
}

export function worstSeverity(alarms: Alarm[]): Severity {
  if (alarms.some((a) => a.severity === "critical")) return "critical";
  if (alarms.some((a) => a.severity === "warn")) return "warn";
  return "ok";
}

/** 503 only on critical: a late worker is not a reason to fail a load balancer check. */
export function healthHttpStatus(status: Severity): number {
  return status === "critical" ? 503 : 200;
}

export async function evaluateHealth(now = Date.now()): Promise<HealthReport> {
  const alarms = await Promise.all(
    MONITORED_WORKERS.map(async (w) => gradeHeartbeat(w, await readHeartbeat(w), now)),
  );
  return { status: worstSeverity(alarms), at: now, alarms };
}
