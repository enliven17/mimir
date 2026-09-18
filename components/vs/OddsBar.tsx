"use client";

/**
 * Where the money is on a claim.
 *
 * Two stacked rows rather than a single split bar: a reader needs to match a
 * percentage to the position it belongs to, and a bare two-tone bar makes them
 * guess which end is which. Side labels carry the actual position text, so the
 * odds are legible without opening the market.
 */

import { formatProbability, oddsBarWidths, type ImpliedOdds } from "@/lib/odds";

interface OddsBarProps {
  odds: ImpliedOdds;
  creatorPosition: string;
  challengerPosition: string;
  /** Feed density: hides the stake amounts and shrinks the type. */
  compact?: boolean;
}

export default function OddsBar({
  odds,
  creatorPosition,
  challengerPosition,
  compact = false,
}: OddsBarProps) {
  const widths = oddsBarWidths(odds);

  if (odds.unpriced) {
    return (
      <div className="space-y-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-pv-surface2">
          <div
            className="h-full w-full bg-[repeating-linear-gradient(45deg,rgba(148,163,184,0.35)_0_6px,transparent_6px_12px)]"
            aria-hidden
          />
        </div>
        <p className={`font-mono ${compact ? "text-[10px]" : "text-[11px]"} text-pv-muted`}>
          no counter-stake yet, so no price
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-pv-surface2"
        role="img"
        aria-label={`Creator side ${formatProbability(odds.creatorProbability)}, challenger side ${formatProbability(odds.challengerProbability)}`}
      >
        <div className="h-full bg-pv-emerald/80" style={{ width: `${widths.creator}%` }} />
        <div className="h-full bg-pv-fuch/80" style={{ width: `${widths.challenger}%` }} />
      </div>

      <div className={`flex items-start justify-between gap-3 ${compact ? "text-[11px]" : "text-[12px]"}`}>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="font-display font-bold tabular-nums text-pv-emerald">
            {formatProbability(odds.creatorProbability)}
          </span>
          <span className="truncate text-pv-text/70">{creatorPosition}</span>
        </div>
        <div className="flex min-w-0 items-baseline justify-end gap-1.5 text-right">
          <span className="truncate text-pv-text/70">{challengerPosition}</span>
          <span className="font-display font-bold tabular-nums text-pv-fuch">
            {formatProbability(odds.challengerProbability)}
          </span>
        </div>
      </div>

      {!compact && odds.challengerPayoutMultiple !== null && (
        <p className="font-mono text-[11px] text-pv-muted">
          challenging pays {odds.challengerPayoutMultiple.toFixed(2)}x
          {odds.mode === "fixed" ? " (fixed by the creator)" : " at the current split"}
        </p>
      )}
    </div>
  );
}
