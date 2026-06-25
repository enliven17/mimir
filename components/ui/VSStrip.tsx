"use client";

import { useTranslations } from "next-intl";
import { shortenAddress } from "@/lib/constants";

interface VSStripProps {
  creator: string;
  creatorPosition: string;
  opponent: string;
  opponentPosition: string;
  isOpen: boolean;
  compact?: boolean;
}

export default function VSStrip({
  creator,
  creatorPosition,
  opponent,
  opponentPosition,
  isOpen,
  compact = false,
}: VSStripProps) {
  const t = useTranslations("strip");

  return (
    <div className="flex overflow-hidden rounded border border-white/[0.12]">
      <div
        className={`min-w-0 flex-1 bg-pv-emerald/[0.05] ${compact ? "px-3 py-2" : "p-4"}`}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-pv-emerald/55">
          {t("creator")}
        </div>
        {!compact && (
          <div className="mt-1 truncate text-sm font-semibold">
            {shortenAddress(creator)}
          </div>
        )}
        <div
          className={`truncate font-medium text-pv-emerald ${
            compact ? "mt-0.5 text-xs" : "mt-1 text-xs"
          }`}
        >
          {creatorPosition}
        </div>
      </div>

      <div className="w-px flex-shrink-0 bg-white/[0.08]" />

      <div
        className={`min-w-0 flex-1 bg-pv-surface2/60 ${compact ? "px-3 py-2" : "p-4"}`}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-pv-muted">
          {t("rival")}
        </div>
        {isOpen ? (
          <div
            className={`italic text-pv-muted ${
              compact ? "mt-0.5 text-xs" : "mt-1 text-xs"
            }`}
          >
            {t("waiting")}
          </div>
        ) : (
          <>
            {!compact && (
              <div className="mt-1 truncate text-sm font-semibold">
                {shortenAddress(opponent)}
              </div>
            )}
            <div
              className={`truncate font-medium text-pv-text ${
                compact ? "mt-0.5 text-xs" : "mt-1 text-xs"
              }`}
            >
              {opponentPosition}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
