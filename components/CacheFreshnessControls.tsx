"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VSCacheFreshness } from "@/lib/vs-freshness";
import CacheFreshnessPill from "@/components/CacheFreshnessPill";

type CacheFreshnessControlsProps = {
  freshness: VSCacheFreshness | null;
  onRefresh: () => void;
  refreshing?: boolean;
  className?: string;
};

export default function CacheFreshnessControls({
  freshness,
  onRefresh,
  refreshing = false,
  className = "",
}: CacheFreshnessControlsProps) {
  const t = useTranslations("cache");

  if (!freshness && !refreshing) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <CacheFreshnessPill freshness={freshness} />
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.03] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[border-color,color,background-color,transform] hover:border-white/[0.2] hover:bg-white/[0.06] hover:text-pv-text disabled:cursor-wait disabled:opacity-70"
      >
        <RefreshCw
          size={12}
          className={refreshing ? "animate-spin" : ""}
          aria-hidden
        />
        <span>{refreshing ? t("refreshing") : t("refresh")}</span>
      </button>
    </div>
  );
}
