"use client";

/**
 * The price of a claim, on its detail page.
 *
 * The metrics row below this shows the pot, the stakes and the clock, which are
 * facts about the market but not a price. This panel answers the question
 * somebody lands on the page with: what does the money already here think, and
 * what would taking the other side pay me?
 *
 * The derivation is stated rather than implied. A number presented as "the
 * odds" without saying where it comes from is asking for trust that a market
 * settled by an oracle has not earned yet.
 */

import { TrendingUp } from "lucide-react";

import type { VSData } from "@/lib/contract";
import { impliedOdds, formatProbability, crowdImbalance } from "@/lib/odds";
import OddsBar from "./OddsBar";

/** Past this, one side is crowded enough that the contrarian case is worth naming. */
const CONTRARIAN_IMBALANCE = 0.5;

export default function MarketPricePanel({ vs }: { vs: VSData }) {
  const odds = impliedOdds(vs);
  const challengerPosition = vs.counter_position ?? vs.opponent_position;
  const settled = vs.state === "resolved" || vs.state === "cancelled";

  // A settled market has an outcome, not a price. Showing the last split would
  // read as a live quote on something that is already decided.
  if (settled) return null;

  const imbalance = crowdImbalance(odds);
  const crowdedSide =
    odds.creatorProbability === null
      ? null
      : odds.creatorProbability > odds.challengerProbability!
        ? { crowded: vs.creator_position, thin: challengerPosition }
        : { crowded: challengerPosition, thin: vs.creator_position };

  return (
    <section className="rounded-xl border border-white/[0.1] bg-pv-bg/55 px-5 py-4 sm:px-6 sm:py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          Market price
        </h2>
        {odds.mode === "fixed" && (
          <span className="rounded border border-pv-fuch/30 bg-pv-fuch/[0.07] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-pv-fuch">
            fixed odds
          </span>
        )}
      </header>

      {odds.unpriced ? (
        <div className="rounded-lg border border-dashed border-pv-border/40 px-4 py-5 text-center">
          <p className="text-sm text-pv-text">Nobody has taken the other side yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">
            Until someone stakes against it there is no price, only the creator&apos;s
            conviction. The first challenger sets the opening split and takes the whole
            creator stake if they are right.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <PriceCell
              label={vs.creator_position}
              probability={formatProbability(odds.creatorProbability)}
              tone="emerald"
              stake={odds.creatorStake}
            />
            <PriceCell
              label={challengerPosition}
              probability={formatProbability(odds.challengerProbability)}
              tone="fuch"
              stake={odds.challengerStake}
            />
          </div>

          <OddsBar
            odds={odds}
            creatorPosition={vs.creator_position}
            challengerPosition={challengerPosition}
          />

          <p className="mt-4 border-t border-pv-border/25 pt-3 text-[11px] leading-relaxed text-pv-muted">
            {odds.mode === "fixed"
              ? "The creator quoted this price up front and reserved the liquidity to honour it, so it does not move as challengers join."
              : "Pari-mutuel: each side's share of the pot is what the money already here implies. Staking against a crowded side pays more, because the crowd's stake is what you win."}
          </p>

          {imbalance >= CONTRARIAN_IMBALANCE && crowdedSide && odds.mode === "pool" && (
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-pv-fuch/25 bg-pv-fuch/[0.05] px-3 py-2 text-[11px] leading-relaxed text-pv-fuch">
              <span aria-hidden>↯</span>
              <span>
                The money is {Math.round(Math.max(odds.creatorProbability!, odds.challengerProbability!) * 100)}% on
                &ldquo;{crowdedSide.crowded}&rdquo;. If &ldquo;{crowdedSide.thin}&rdquo; is right, it pays{" "}
                {odds.challengerPayoutMultiple!.toFixed(2)}x.
              </span>
            </p>
          )}
        </>
      )}
    </section>
  );
}

function PriceCell({
  label,
  probability,
  stake,
  tone,
}: {
  label: string;
  probability: string;
  stake: number;
  tone: "emerald" | "fuch";
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-pv-emerald/25 bg-pv-emerald/[0.05] text-pv-emerald"
      : "border-pv-fuch/25 bg-pv-fuch/[0.05] text-pv-fuch";

  return (
    <div className={`rounded-lg border px-3.5 py-3 ${toneClasses}`}>
      <p className="font-display text-2xl font-bold tabular-nums leading-none sm:text-3xl">
        {probability}
      </p>
      <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-pv-text/85">
        {label}
      </p>
      <p className="mt-1 font-mono text-[10px] text-pv-muted">
        {stake.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC staked
      </p>
    </div>
  );
}
