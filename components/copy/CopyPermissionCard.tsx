"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { getChain, parseChainKey, vsPath } from "@/lib/chains";
import { formatUsdc } from "@/lib/money";
import type { CopyPermissionView } from "@/lib/copy-client";
import { COPY_CATEGORIES, type CopyCategory } from "@/lib/copy-form";

function isCopyCategory(c: string): c is CopyCategory {
  return (COPY_CATEGORIES as readonly string[]).includes(c);
}

type PermissionStatus = "active" | "expired" | "revoked";

function statusOf(p: CopyPermissionView, now: number): PermissionStatus {
  if (!p.active) return "revoked";
  return p.expiresAt <= now ? "expired" : "active";
}

const STATUS_CLASS: Record<PermissionStatus, string> = {
  active: "border-pv-emerald/60 bg-pv-emerald/20 text-pv-text",
  expired: "border-white/[0.15] text-pv-muted",
  revoked: "border-pv-danger/40 text-pv-danger",
};

interface CopyPermissionCardProps {
  permission: CopyPermissionView;
  /** When the list was loaded; status is judged against it so renders stay pure. */
  now: number;
  revoking: boolean;
  /** Another revoke is in flight; one wallet prompt at a time. */
  locked: boolean;
  onRevoke: (id: string) => void;
}

export default function CopyPermissionCard({
  permission: p,
  now,
  revoking,
  locked,
  onRevoke,
}: CopyPermissionCardProps) {
  const t = useTranslations("copy.card");
  const tCat = useTranslations("copy.categories");
  const format = useFormatter();
  const status = statusOf(p, now);
  const statusLabel = {
    active: t("statusActive"),
    expired: t("statusExpired"),
    revoked: t("statusRevoked"),
  }[status];

  const categoryLabel = (c: string) => (isCopyCategory(c) ? tCat(c) : c);

  const limits: Array<[string, string]> = [
    [t("perPosition"), formatUsdc(p.maxPerPositionUsdc)],
    [t("perDay"), formatUsdc(p.maxDailyUsdc)],
    [t("perWeek"), formatUsdc(p.maxWeeklyUsdc)],
    [t("openExposure"), formatUsdc(p.maxOpenExposureUsdc)],
    [t("lossStop"), formatUsdc(p.maxRealizedLossUsdc)],
    [t("minQuality"), `${p.minClaimQuality}/100`],
    [t("minPayout"), `${p.minPayoutRatio}x`],
    [
      t("categories"),
      p.allowedCategories.length > 0 ? p.allowedCategories.map(categoryLabel).join(", ") : t("anyCategory"),
    ],
  ];

  return (
    <article className="rounded-2xl border border-white/[0.12] bg-pv-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-all font-mono text-sm font-semibold text-pv-text">{p.id}</h3>
          <p className="mt-1 break-words text-xs text-pv-muted">
            {t("copies", { agent: p.signalAgentId })}{" "}
            <span className="text-pv-muted/80">{t("executedBy", { agent: p.executionAgentId })}</span>
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] ${STATUS_CLASS[status]}`}
        >
          {statusLabel}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {limits.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded border border-white/[0.1] bg-white/[0.03] px-3 py-2">
            <dt className="break-words font-mono text-[10px] uppercase tracking-[0.12em] text-pv-muted">{label}</dt>
            <dd className="mt-0.5 break-words text-[13px] tabular-nums text-pv-text">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 font-mono text-[11px] text-pv-muted">
        {t("expires")}:{" "}
        <time dateTime={new Date(p.expiresAt).toISOString()} className="text-pv-text">
          {format.dateTime(new Date(p.expiresAt), { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </p>

      <section className="mt-4 border-t border-white/[0.08] pt-3" aria-label={t("recentTitle")}>
        <h4 className="label mb-2">{t("recentTitle")}</h4>
        {p.recent.length === 0 ? (
          <p className="text-xs text-pv-muted">{t("recentEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {p.recent.map((e) => {
              const chain = getChain(parseChainKey(e.chain, "arc"));
              return (
                <li
                  key={`${e.chain}-${e.claimId}-${e.at}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                >
                  <Link
                    href={vsPath(e.claimId, chain.key)}
                    className="focus-ring font-mono text-pv-text underline decoration-pv-emerald underline-offset-4"
                  >
                    {t("claim", { id: e.claimId })}
                  </Link>
                  <span className={e.executed ? "text-pv-text" : "text-pv-muted"}>
                    {e.executed
                      ? t("executed", { amount: formatUsdc(e.stakeUsdc) })
                      : t("skipped", { reason: (e.skipReason ?? "unknown").replace(/_/g, " ") })}
                  </span>
                  <time dateTime={new Date(e.at).toISOString()} className="font-mono text-[10px] text-pv-muted">
                    {format.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short" })}
                  </time>
                  {e.txHash ? (
                    <a
                      href={`${chain.explorerUrl}/tx/${e.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-pv-muted hover:text-pv-text"
                    >
                      {t("viewTx")}
                      <ArrowUpRight className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {status === "active" ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="btn-danger focus-ring min-h-[44px] w-auto px-4 py-2 text-xs"
            onClick={() => onRevoke(p.id)}
            disabled={locked}
            aria-busy={revoking || undefined}
            aria-label={t("revokeAria", { id: p.id })}
          >
            {revoking ? t("revoking") : t("revoke")}
          </button>
        </div>
      ) : null}
    </article>
  );
}
