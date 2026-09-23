"use client";

/**
 * A claim in the feed.
 *
 * Built around the three things someone scanning decides on: what is being
 * claimed, where the money already is, and how long is left. The previous card
 * showed the question and a pot total, which says nothing about whether the
 * market is worth taking the other side of.
 */

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Clock, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import {
  getVSChallengerCount,
  getVSTotalPot,
  isVSJoinable,
  vsChain,
  type VSData,
} from "@/lib/contract";
import { vsPath } from "@/lib/chains";
import ChainBadge from "./ui/ChainBadge";
import { shortenAddress, getCategoryInfo, ZERO_ADDRESS, getTimeRemaining } from "@/lib/constants";
import { impliedOdds, crowdImbalance } from "@/lib/odds";
import OddsBar from "./vs/OddsBar";

interface VSCardProps {
  vs: VSData;
  showCategory?: boolean;
  showAcceptCTA?: boolean;
  /** Demo claims (negative ids): different styling plus an optional badge. */
  isSample?: boolean;
  sampleBadgeLabel?: string;
  /**
   * When set, the category pill links to Explore filtered to this category.
   * Uses an overlay plus pointer-events to avoid nesting anchors.
   */
  categoryFilterHref?: string;
  /** The "challenges" label next to the creator (Explore hides it). */
  showChallengesLabel?: boolean;
}

const pillClass =
  "rounded border border-pv-emerald/25 bg-pv-emerald/[0.06] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald/90";

/** Past this, one side is crowded enough that the other is worth pointing at. */
const CONTRARIAN_IMBALANCE = 0.5;

export default function VSCard({
  vs,
  showCategory = false,
  showAcceptCTA = false,
  isSample = false,
  sampleBadgeLabel,
  categoryFilterHref,
  showChallengesLabel = true,
}: VSCardProps) {
  const catInfo = getCategoryInfo(vs.category);
  const isOpen = vs.opponent === ZERO_ADDRESS;
  const pool = getVSTotalPot(vs);
  const isJoinable = isVSJoinable(vs);
  const challengerCount = getVSChallengerCount(vs);
  const maxChallengers =
    typeof vs.max_challengers === "number" && vs.max_challengers > 0 ? vs.max_challengers : 1;
  const odds = impliedOdds(vs);
  const imbalance = crowdImbalance(odds);
  const isSettled = vs.state === "resolved";
  const t = useTranslations("vsDetail");
  const tCat = useTranslations("categories");

  const remaining = getTimeRemaining(vs.deadline, "en");
  const expired = remaining.expired;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`group card card-hover relative p-5 ${
        isSample
          ? "border border-dashed border-pv-emerald/35 bg-pv-surface/80 ring-1 ring-pv-emerald/[0.12]"
          : ""
      }`}
    >
      <Link href={vsPath(vs.id, vsChain(vs))} className="absolute inset-0 z-0 rounded" aria-label={vs.question} />

      <div className="pointer-events-none absolute left-0 top-0 h-full w-2/5 bg-[radial-gradient(ellipse_at_0%_50%,rgba(51,79,169,0.06),transparent_65%)]" />

      <div className="pointer-events-none relative z-10">
        {/* Provenance and category */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {isSample && sampleBadgeLabel ? (
              <span className={`shrink-0 ${pillClass} tracking-[0.14em]`}>{sampleBadgeLabel}</span>
            ) : null}
            <ChainBadge chain={vsChain(vs)} compact />
            <span className="text-[13px] font-semibold">{shortenAddress(vs.creator)}</span>
            {showChallengesLabel ? (
              <span className="text-xs text-pv-muted">{t("challenges")}</span>
            ) : null}
          </div>
          {showCategory &&
            (categoryFilterHref ? (
              <Link
                href={categoryFilterHref}
                className={`pointer-events-auto inline-block ${pillClass} transition-colors hover:border-pv-emerald/35 hover:bg-pv-emerald/[0.1]`}
                onClick={(e) => e.stopPropagation()}
              >
                {tCat(catInfo.id)}
              </Link>
            ) : (
              <span className={pillClass}>{tCat(catInfo.id)}</span>
            ))}
        </div>

        <h3 className="mb-4 font-display text-lg font-bold leading-snug tracking-tight">
          {vs.question}
        </h3>

        {isSettled ? (
          <SettledOutcome vs={vs} />
        ) : (
          <OddsBar
            odds={odds}
            creatorPosition={vs.creator_position}
            challengerPosition={vs.counter_position ?? vs.opponent_position}
            compact
          />
        )}

        {/* The numbers someone decides on */}
        <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-pv-border/25 pt-3 font-mono text-[11px] text-pv-muted">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Pool</dt>
            <dd className="font-bold tabular-nums text-pv-gold">{pool} USDC</dd>
            <span className="text-pv-muted/70">pool</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" aria-hidden />
            <dt className="sr-only">Time remaining</dt>
            <dd className={`tabular-nums ${expired ? "text-pv-muted" : "text-pv-text/85"}`}>
              {expired ? (isSettled ? "settled" : "awaiting settlement") : remaining.text}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3" aria-hidden />
            <dt className="sr-only">Challengers</dt>
            <dd className="tabular-nums text-pv-text/85">
              {challengerCount}/{maxChallengers}
            </dd>
          </div>
          {isOpen && !isSettled && (
            <span className="rounded border border-pv-cyan/30 bg-pv-cyan/[0.07] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-pv-cyan">
              needs a challenger
            </span>
          )}
          {!isOpen && !isSettled && imbalance >= CONTRARIAN_IMBALANCE && (
            <span className="rounded border border-pv-fuch/30 bg-pv-fuch/[0.07] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-pv-fuch">
              crowded, pays more the other way
            </span>
          )}
        </dl>

        {showAcceptCTA && isJoinable && (
          <div className="mt-3.5 w-full rounded border border-pv-fuch/[0.2] bg-pv-fuch/[0.08] py-3 text-center font-display text-sm font-bold text-pv-fuch transition-colors group-hover:bg-pv-fuch/[0.13]">
            {t("acceptAndStake", { amount: vs.stake_amount })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** A settled claim shows the verdict, not a price that no longer means anything. */
function SettledOutcome({ vs }: { vs: VSData }) {
  const side = vs.winner_side;
  const refunded = side === "draw" || side === "unresolvable";
  const label = refunded
    ? side === "draw"
      ? "Draw, everyone refunded"
      : "Unresolvable, everyone refunded"
    : side === "creator"
      ? vs.creator_position
      : (vs.counter_position ?? vs.opponent_position);

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        refunded
          ? "border-pv-border/40 bg-pv-surface2/40"
          : side === "creator"
            ? "border-pv-emerald/30 bg-pv-emerald/[0.07]"
            : "border-pv-fuch/30 bg-pv-fuch/[0.07]"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">settled</p>
      <p
        className={`mt-0.5 truncate font-display text-sm font-bold ${
          refunded ? "text-pv-text/80" : side === "creator" ? "text-pv-emerald" : "text-pv-fuch"
        }`}
      >
        {label}
      </p>
      {typeof vs.confidence === "number" && vs.confidence > 0 && (
        <p className="mt-0.5 font-mono text-[10px] text-pv-muted">
          {vs.confidence}% confidence
        </p>
      )}
    </div>
  );
}
