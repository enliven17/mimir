"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getVSChallengerCount,
  getVSTotalPot,
  isVSJoinable,
  type VSData,
} from "@/lib/contract";
import { shortenAddress, getCategoryInfo, ZERO_ADDRESS } from "@/lib/constants";
import VSStrip from "./ui/VSStrip";

interface VSCardProps {
  vs: VSData;
  showCategory?: boolean;
  showAcceptCTA?: boolean;
  /** VS de demostración (ids negativos): estilo distinto + badge opcional */
  isSample?: boolean;
  sampleBadgeLabel?: string;
  /**
   * Si se define, la píldora de categoría enlaza a Explore con `?cat=` (misma categoría que `vs.category`).
   * Usa overlay + `pointer-events` para evitar `<a>` anidados.
   */
  categoryFilterHref?: string;
  /** Texto "challenges" junto al creador (p. ej. Explore lo oculta) */
  showChallengesLabel?: boolean;
}

/** Misma píldora que ArenaCard (categoría + POOL): sin borde blanco del `.chip` global */
const vsCardPillClass =
  "rounded border border-pv-emerald/25 bg-pv-emerald/[0.06] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald/90";

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
    typeof vs.max_challengers === "number" && vs.max_challengers > 0
      ? vs.max_challengers
      : 1;
  const marketType = vs.market_type ?? "binary";
  const oddsMode = vs.odds_mode ?? "pool";
  const t = useTranslations("vsDetail");
  const tCat = useTranslations("categories");

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
      <Link
        href={`/vs/${vs.id}`}
        className="absolute inset-0 z-0 rounded"
        aria-label={vs.question}
      />

      <div className="pointer-events-none absolute left-0 top-0 h-full w-2/5 bg-[radial-gradient(ellipse_at_0%_50%,rgba(78,222,163,0.06),transparent_65%)]" />

      <div className="relative z-10 pointer-events-none">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {isSample && sampleBadgeLabel ? (
              <span className={`shrink-0 ${vsCardPillClass} tracking-[0.14em]`}>
                {sampleBadgeLabel}
              </span>
            ) : null}
            <span className="text-[13px] font-semibold">
              {shortenAddress(vs.creator)}
            </span>
            {showChallengesLabel ? (
              <span className="text-xs text-pv-muted">{t("challenges")}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {showCategory &&
              (categoryFilterHref ? (
                <Link
                  href={categoryFilterHref}
                  className={`pointer-events-auto inline-block ${vsCardPillClass} transition-colors hover:border-pv-emerald/35 hover:bg-pv-emerald/[0.1]`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {tCat(catInfo.id)}
                </Link>
              ) : (
                <span className={vsCardPillClass}>{tCat(catInfo.id)}</span>
              ))}
            <span className="font-mono text-[13px] font-bold text-pv-gold">
              {pool} GEN
            </span>
          </div>
        </div>

        <div className="font-display text-lg font-bold leading-snug mb-3.5 tracking-tight">
          {vs.question}
        </div>

        <VSStrip
          creator={vs.creator}
          creatorPosition={vs.creator_position}
          opponent={vs.opponent}
          opponentPosition={vs.opponent_position}
          isOpen={isOpen}
          compact
        />

          <div className="flex flex-wrap gap-2 mt-3">
            <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-[0.12em] border border-pv-cyan/[0.25] bg-pv-cyan/[0.08] text-pv-cyan">
              {t(`marketTypes.${marketType}`)}
            </span>
            <span className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-[0.12em] border border-pv-fuch/[0.25] bg-pv-fuch/[0.08] text-pv-fuch">
              {oddsMode === "fixed" ? t("oddsModes.fixed") : t("oddsModes.pool")}
            </span>
            <span className="px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-[0.12em] border border-pv-emerald/30 bg-pv-emerald/[0.08] text-pv-emerald">
              {t("slotsFilled", { count: challengerCount, total: maxChallengers })}
            </span>
          </div>

          {showAcceptCTA && isJoinable && (
            <div className="w-full py-3 mt-3.5 rounded bg-pv-fuch/[0.08] border border-pv-fuch/[0.2] text-center font-display text-sm font-bold text-pv-fuch group-hover:bg-pv-fuch/[0.13] transition-colors">
              {t("acceptAndStake", { amount: vs.stake_amount })}
            </div>
          )}
        </div>
    </motion.div>
  );
}
