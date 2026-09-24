/**
 * Worker heartbeats.
 *
 * Each poll loop reports into `sync_meta` so the health endpoint can tell a
 * worker that is alive from one that died quietly. Writes are best-effort: a
 * database outage must never stop an agent from settling markets.
 */
import { getSyncMeta, setSyncMeta } from "../db";
import { capabilityForWorker, isPaused } from "./flags";

export type WorkerName = "oracle" | "market_creator" | "council";

export const MONITORED_WORKERS: WorkerName[] = ["oracle", "market_creator", "council"];

export interface Heartbeat {
  worker: WorkerName;
  /** ms epoch of the last report, whether it succeeded or failed. */
  at: number;
  /** How often this worker is expected to report, in seconds. */
  intervalSec: number;
  ok: boolean;
  error?: string;
}

const key = (worker: WorkerName) => `heartbeat:${worker}`;

export async function beat(
  worker: WorkerName,
  intervalSec: number,
  ok: boolean,
  error?: unknown,
): Promise<void> {
  const payload: Heartbeat = {
    worker,
    at: Date.now(),
    intervalSec,
    ok,
    ...(error === undefined ? {} : { error: String(error instanceof Error ? error.message : error).slice(0, 300) }),
  };
  try {
    await setSyncMeta(key(worker), JSON.stringify(payload));
  } catch {
    /* heartbeats are advisory, never load-bearing */
  }
}

export async function readHeartbeat(worker: WorkerName): Promise<Heartbeat | null> {
  try {
    const raw = await getSyncMeta(key(worker));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Heartbeat;
    return parsed && typeof parsed.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Wrap a poll loop so it reports on every cycle.
 *
 * Beats once immediately on startup: without it a restarted worker looks dead
 * until its first full interval elapses, which for the market creator is six
 * hours.
 */
export function reportingPoll(
  worker: WorkerName,
  intervalMs: number,
  poll: () => Promise<void>,
): () => Promise<void> {
  const intervalSec = Math.round(intervalMs / 1000);
  void beat(worker, intervalSec, true);
  const pauseSwitch = capabilityForWorker(worker);
  return async () => {
    if (pauseSwitch && isPaused(pauseSwitch)) {
      console.log(`[${worker}] paused (MIMIR_PAUSE_${pauseSwitch.toUpperCase()}), skipping this cycle.`);
      await beat(worker, intervalSec, true);
      return;
    }
    try {
      await poll();
      await beat(worker, intervalSec, true);
    } catch (err) {
      console.error(`[${worker}] poll failed, will retry next interval:`, err);
      await beat(worker, intervalSec, false, err);
    }
  };
}
