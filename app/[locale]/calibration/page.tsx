import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { COUNCIL_PERSONAS } from "@/agents/council/personas";
import { calibrate, COIN_FLIP_BRIER, type CalibrationRow } from "@/lib/calibration";
import { scoredForecasts } from "@/lib/server/forecasts";
import { cachedFor } from "@/lib/server/ttl-cache";

export const dynamic = "force-dynamic";

const loadRows = cachedFor(async (): Promise<CalibrationRow[]> => calibrate(await scoredForecasts()), 60_000);

function nameOf(slug: string): string {
  if (slug === "oracle") return "Mimir oracle";
  const p = COUNCIL_PERSONAS.find((x) => x.slug === slug);
  return p ? `${p.emoji} ${p.displayName}` : slug;
}

function verdictOn(brier: number): { label: string; className: string } {
  if (brier < 0.18) return { label: "sharp", className: "text-emerald-300" };
  if (brier < COIN_FLIP_BRIER) return { label: "better than chance", className: "text-pv-text" };
  return { label: "no better than a coin", className: "text-pv-danger" };
}

export default async function CalibrationPage() {
  const rows = await loadRows().catch(() => [] as CalibrationRow[]);

  return (
    <div className="pb-12">
      <BlueprintHeading>Who forecasts well?</BlueprintHeading>
      <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        <p className="mx-auto mb-6 max-w-2xl text-center text-sm text-pv-muted">
          Every council persona and the oracle record a forecast before a claim&apos;s deadline. Once the claim
          settles, each forecast is scored with the Brier score: 0 is perfect, {COIN_FLIP_BRIER} is a coin flip.
          Draws and refunds are not scored. Stakes are not required: an abstention still counts as a forecast.
        </p>

        {rows.length === 0 ? (
          <p className="text-center text-sm text-pv-muted">No settled forecasts yet. Scores appear as claims resolve.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-pv-border/40">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="bg-pv-surface/60 font-mono text-[11px] uppercase tracking-[0.14em] text-pv-muted">
                <tr>
                  <th className="px-4 py-3">Forecaster</th>
                  <th className="px-4 py-3 text-right">Settled</th>
                  <th className="px-4 py-3 text-right">Brier</th>
                  <th className="px-4 py-3 text-right">Right side</th>
                  <th className="px-4 py-3">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const v = verdictOn(r.brier);
                  return (
                    <tr key={r.forecaster} className="border-t border-pv-border/30">
                      <td className="px-4 py-3 text-pv-text">{nameOf(r.forecaster)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-pv-text/85">{r.forecasts}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-pv-text">{r.brier.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-pv-text/85">{Math.round(r.hitRate * 100)}%</td>
                      <td className={`px-4 py-3 text-xs ${v.className}`}>{v.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-center text-sm">
          <Link href="/council" className="text-pv-muted hover:text-pv-text">← the council</Link>
        </p>
      </div>
    </div>
  );
}
