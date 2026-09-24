/**
 * Calibration: are the council and the oracle actually good forecasters?
 *
 * Every forecast before a deadline becomes a probability that the challengers
 * win. Once the claim settles on a side, the Brier score is (p - outcome)^2,
 * averaged: 0 is perfect, 0.25 is a coin flip, anything above 0.25 is worse
 * than not trying. Draws and refunds have no outcome and are left out.
 *
 * Pure: the numbers come from lib/server/forecasts.ts.
 */

/** The same mapping the self-resolving council uses: 50% ± confidence/2. */
export function probabilityFromVerdict(verdict: string, confidence: number): number {
  const c = Math.max(0, Math.min(100, confidence));
  if (verdict === "CHALLENGERS_WIN") return 0.5 + c / 200;
  if (verdict === "CREATOR_WINS") return 0.5 - c / 200;
  return 0.5;
}

export interface ScoredForecast {
  forecaster: string;
  pChallengers: number;
  /** "creator" | "challengers"; anything else is not scored. */
  winnerSide: string;
}

export interface CalibrationRow {
  forecaster: string;
  forecasts: number;
  brier: number;
  /** Share of forecasts that leaned to the side that won (ties excluded). */
  hitRate: number;
}

export const COIN_FLIP_BRIER = 0.25;

export function calibrate(rows: ScoredForecast[]): CalibrationRow[] {
  const by = new Map<string, { n: number; sq: number; hits: number; leaned: number }>();
  for (const r of rows) {
    if (r.winnerSide !== "creator" && r.winnerSide !== "challengers") continue;
    if (!Number.isFinite(r.pChallengers)) continue;
    const y = r.winnerSide === "challengers" ? 1 : 0;
    const acc = by.get(r.forecaster) ?? { n: 0, sq: 0, hits: 0, leaned: 0 };
    acc.n += 1;
    acc.sq += (r.pChallengers - y) ** 2;
    if (r.pChallengers !== 0.5) {
      acc.leaned += 1;
      if ((r.pChallengers > 0.5) === (y === 1)) acc.hits += 1;
    }
    by.set(r.forecaster, acc);
  }
  return [...by.entries()]
    .map(([forecaster, a]) => ({
      forecaster,
      forecasts: a.n,
      brier: a.sq / a.n,
      hitRate: a.leaned > 0 ? a.hits / a.leaned : 0,
    }))
    .sort((a, b) => a.brier - b.brier || b.forecasts - a.forecasts);
}
