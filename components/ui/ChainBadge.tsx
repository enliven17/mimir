"use client";

import { getChain, type ChainKey } from "@/lib/chains";
import { CHAIN_DOT_CLASS, isMultichain } from "@/lib/chainUi";
import { useTranslations } from "next-intl";

interface ChainBadgeProps {
  chain: ChainKey;
  compact?: boolean;
  /** Render even when only one network is live (e.g. inside a network-specific notice). */
  always?: boolean;
  className?: string;
}

/**
 * Network tag for a claim: colored dot + short chain name, same shape as the
 * status Badge. Hidden while Arc is the only deployed network.
 */
export default function ChainBadge({
  chain,
  compact = false,
  always = false,
  className = "",
}: ChainBadgeProps) {
  const t = useTranslations("network");
  if (!always && !isMultichain()) return null;
  const cfg = getChain(chain);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border border-white/[0.18] bg-white/[0.04] font-bold uppercase tracking-[0.1em] text-pv-text/85 ${
        compact ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]"
      } ${className}`}
      title={t("onNetwork", { name: cfg.name })}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${CHAIN_DOT_CLASS[chain]}`}
        aria-hidden
      />
      <span className="sr-only">{t("networkLabel")}: </span>
      {cfg.shortName}
    </span>
  );
}
