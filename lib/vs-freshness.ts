export type VSCacheFreshnessSource = "index" | "contract";
export type VSCacheFreshnessStatus = "live" | "cached" | "stale";

export interface VSCacheFreshness {
  source: VSCacheFreshnessSource;
  status: VSCacheFreshnessStatus;
  lastUpdatedAt: string | null;
  ageMs: number | null;
  freshnessWindowMs: number;
}

const STALE_MULTIPLIER = 5;

export function buildVSCacheFreshness(args: {
  updatedAtMs?: number | null;
  freshnessWindowMs: number;
  source: VSCacheFreshnessSource;
}): VSCacheFreshness {
  const updatedAtMs =
    typeof args.updatedAtMs === "number" && Number.isFinite(args.updatedAtMs)
      ? args.updatedAtMs
      : null;
  const ageMs = updatedAtMs == null ? null : Math.max(0, Date.now() - updatedAtMs);

  let status: VSCacheFreshnessStatus = "stale";
  if (ageMs != null) {
    if (ageMs <= args.freshnessWindowMs) {
      status = "live";
    } else if (ageMs <= args.freshnessWindowMs * STALE_MULTIPLIER) {
      status = "cached";
    }
  }

  return {
    source: args.source,
    status,
    lastUpdatedAt: updatedAtMs == null ? null : new Date(updatedAtMs).toISOString(),
    ageMs,
    freshnessWindowMs: args.freshnessWindowMs,
  };
}

export function makeContractFreshness(): VSCacheFreshness {
  return buildVSCacheFreshness({
    updatedAtMs: Date.now(),
    freshnessWindowMs: 1,
    source: "contract",
  });
}
