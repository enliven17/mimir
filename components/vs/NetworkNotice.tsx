"use client";

/**
 * Which network a stake lands on, and what that costs the user: on Arc USDC is
 * both stake and gas; on Base/Arbitrum gas is ETH and staking needs an exact
 * USDC approve first (two wallet prompts). Shown next to every stake action.
 */
import { useTranslations } from "next-intl";
import { getChain, type ChainKey } from "@/lib/chains";
import ChainBadge from "@/components/ui/ChainBadge";

export default function NetworkNotice({
  chain,
  note,
  className = "",
}: {
  chain: ChainKey;
  /** Extra line, e.g. why this network was picked (rematch, claim page). */
  note?: string;
  className?: string;
}) {
  const t = useTranslations("network");
  const cfg = getChain(chain);
  const gasHint =
    cfg.stakeMode === "erc20"
      ? t("gasEth", { name: cfg.name })
      : t("gasNative", { name: cfg.name });

  return (
    <div
      className={`rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3 text-left ${className}`}
      role="note"
      aria-label={t("onNetwork", { name: cfg.name })}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
          {t("networkLabel")}
        </span>
        <ChainBadge chain={chain} always />
        <span className="text-xs font-semibold text-pv-text">{cfg.name}</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-pv-muted">{gasHint}</p>
      {note ? <p className="mt-1 text-[11px] leading-relaxed text-pv-muted">{note}</p> : null}
    </div>
  );
}
