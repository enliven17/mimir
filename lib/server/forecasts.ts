/**
 * Forecast log for the calibration panel. Not `server-only`: the council and
 * oracle workers write here. One row per (claim, forecaster); a re-evaluation
 * keeps the first forecast, the one that was made furthest from the outcome.
 */
import { query } from "../db";
import type { ScoredForecast } from "../calibration";

export async function recordForecast(args: {
  chain: string;
  claimId: number;
  forecaster: string;
  pChallengers: number;
  verdict: string;
  confidence: number;
}): Promise<void> {
  await query(
    `INSERT INTO forecasts(chain, claim_id, forecaster, p_challengers, verdict, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (chain, claim_id, forecaster) DO NOTHING`,
    [args.chain, args.claimId, args.forecaster, args.pChallengers, args.verdict, args.confidence, Date.now()],
  );
}

/** Forecasts on claims that settled on a side, with that side. */
export async function scoredForecasts(): Promise<ScoredForecast[]> {
  const rows = await query(
    `SELECT f.forecaster, f.p_challengers, c.winner_side
       FROM forecasts f
       JOIN claims c ON c.chain = f.chain AND c.id = f.claim_id
      WHERE c.state = 'resolved' AND c.winner_side IN ('creator', 'challengers')`,
  );
  return rows.map((r) => ({
    forecaster: String(r.forecaster),
    pChallengers: Number(r.p_challengers),
    winnerSide: String(r.winner_side),
  }));
}
