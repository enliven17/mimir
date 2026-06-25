"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PlusCircle } from "lucide-react";
import { getVSChallengerCount, getVSTotalPot, type VSData } from "@/lib/contract";
import { Button } from "@/components/ui";
import { BlueprintHeading } from "@/components/BlueprintGrid";

type FeedRow =
  | {
      kind: "live";
      vs: VSData;
    }
  | {
      kind: "demo";
      id: string;
      contextKey: string;
      titleKey: string;
      col1LabelKey: string;
      col1Value: string;
      col2LabelKey: string;
      col2Value: string;
      col3LabelKey: string;
      col3StateKey: "archiveStateOpen" | "archiveStateLive" | "archiveStateSettled";
      col3Accent?: boolean;
      pulse?: boolean;
    };

function stateLabel(vs: VSData, t: (key: string) => string): string {
  if (vs.state === "resolved" || vs.state === "cancelled") {
    return t("archiveStateSettled");
  }
  if (vs.state === "accepted") {
    return t("archiveStateLive");
  }
  return t("archiveStateOpen");
}

function formatUsdcAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

export default function SettlementArchiveSection({
  allVS,
  loading,
}: {
  allVS: VSData[];
  loading: boolean;
}) {
  const t = useTranslations("home");
  const tCat = useTranslations("categories");

  const totalPool = useMemo(
    () => allVS.reduce((sum, v) => sum + getVSTotalPot(v), 0),
    [allVS]
  );
  const openCount = useMemo(
    () => allVS.filter((v) => v.state === "open").length,
    [allVS]
  );

  const feedRows: FeedRow[] = useMemo(
    () => allVS.slice(0, 3).map((vs) => ({ kind: "live" as const, vs })),
    [allVS],
  );

  return (
    <section aria-labelledby="settlement-archive-heading">
      <BlueprintHeading>{t("archiveTitle")}</BlueprintHeading>

      {/* Headline stats — blueprint divider grid */}
      <div
        className="grid grid-cols-2 gap-px border-x border-pv-border/25 bg-pv-border/25"
        aria-busy={loading}
      >
        <div className="bg-pv-bg px-5 py-7 text-center sm:py-9">
          <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
            {t("archiveStatTotalPool")}
          </span>
          <span
            className="font-display text-3xl font-medium tabular-nums tracking-tighter text-pv-text sm:text-4xl"
            style={{ textShadow: "0 0 24px rgba(51,79,169, 0.22)" }}
          >
            {loading ? "—" : `${totalPool.toFixed(2)} USDC`}
          </span>
        </div>
        <div className="bg-pv-bg px-5 py-7 text-center sm:py-9">
          <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
            {t("archiveStatOpenChallenges")}
          </span>
          <span className="font-display text-3xl font-medium tabular-nums tracking-tighter text-pv-emerald sm:text-4xl">
            {loading ? "—" : openCount}
          </span>
        </div>
      </div>

      {/* Insight CTA strip — framed blueprint cell */}
      <div className="group relative overflow-hidden border-x border-pv-border/25 bg-pv-surface px-6 py-10 sm:p-10 md:p-12">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-[0.14] transition-opacity duration-700 group-hover:opacity-[0.2]"
          aria-hidden
        >
          <div className="h-full w-full bg-gradient-to-l from-pv-emerald/40 via-pv-emerald/10 to-transparent" />
        </div>
        <div className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-pv-emerald/20 blur-3xl" aria-hidden />
        <div className="relative z-10 max-w-xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pv-emerald opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pv-emerald" />
            </span>
            <h3 className="font-display text-xl font-bold uppercase tracking-tight text-pv-text sm:text-2xl">
              {t("archiveGlassTitle")}
            </h3>
          </div>
          <p className="mb-10 font-display text-[clamp(1.35rem,4vw,2.25rem)] font-medium leading-tight tracking-tight text-pv-text">
            {t("archiveGlassHeadline")}
          </p>
          <Link href="/explorer" className="inline-block">
            <Button variant="primary" className="px-8 font-display text-xs font-bold uppercase tracking-[0.2em]">
              {t("archiveGlassCta")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Terminal feed — blueprint band + framed rows */}
      <BlueprintHeading>{t("archiveTerminalTitle")}</BlueprintHeading>
      <div className="grid gap-px border-x border-pv-border/25 bg-pv-border/25">
          {feedRows.map((row) =>
            row.kind === "live" ? (
              <Link
                key={row.vs.id}
                href={`/vs/${row.vs.id}`}
                className="group flex gap-6 bg-pv-bg p-5 transition-colors duration-300 hover:bg-pv-surface md:flex-row md:flex-nowrap md:items-center md:justify-between md:gap-8 md:p-6"
              >
                {/* Columna izquierda: enumeración centrada verticalmente */}
                <div className="flex shrink-0 items-center self-stretch">
                  <span className="font-display text-base sm:text-lg tabular-nums text-pv-emerald/60">
                    #{row.vs.id}
                  </span>
                </div>

                {/* Columna derecha: título / canal arriba, datos a la derecha (o debajo en mobile) */}
                <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
                  <div className="min-w-0 max-w-full md:max-w-[55%] lg:max-w-[50%]">
                    <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                      {tCat(row.vs.category)} / {t("archiveTerminalChannel")}
                    </span>
                    <span className="line-clamp-2 font-display text-base font-bold leading-snug text-pv-text sm:text-lg">
                      {row.vs.question}
                    </span>
                  </div>

                  <div className="flex flex-nowrap items-stretch gap-6 sm:gap-8 md:flex-none md:min-w-[260px] lg:min-w-[300px]">
                    <div className="text-center min-w-[4.5rem]">
                      <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide text-pv-muted">
                        {t("archiveColPool")}
                      </span>
                      <span className="font-display text-lg font-medium tabular-nums text-pv-text sm:text-xl">
                        {formatUsdcAmount(getVSTotalPot(row.vs))}
                        <span className="ml-0.5 text-sm font-normal text-pv-muted">USDC</span>
                      </span>
                    </div>
                    <div className="text-center min-w-[4.5rem]">
                      <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide text-pv-muted">
                        {t("archiveColChallengers")}
                      </span>
                      <span className="font-display text-lg font-medium tabular-nums text-pv-text sm:text-xl">
                        {getVSChallengerCount(row.vs)}
                      </span>
                    </div>
                    <div className="text-center min-w-[5.5rem]">
                      <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide text-pv-muted">
                        {t("archiveColState")}
                      </span>
                      <span
                        className={`font-display text-lg font-medium sm:text-xl ${
                          row.vs.state === "accepted"
                            ? "text-pv-emerald"
                            : row.vs.state === "open"
                              ? "text-pv-text"
                              : "text-pv-muted"
                        }`}
                      >
                        {stateLabel(row.vs, t)}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div
                key={row.id}
                className="group flex gap-6 bg-pv-bg p-5 transition-colors duration-300 hover:bg-pv-surface md:flex-row md:flex-nowrap md:items-center md:justify-between md:gap-8 md:p-6"
              >
                {/* Columna izquierda: enumeración demo centrada verticalmente */}
                <div className="flex shrink-0 items-center self-stretch">
                  <span className="font-display text-base sm:text-lg tabular-nums text-pv-emerald/60">
                    #{row.id.replace("demo-", "")}
                  </span>
                </div>

                {/* Columna derecha: título / contexto arriba, datos a la derecha (o debajo en mobile) */}
                <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
                  <div className="min-w-0 max-w-full md:max-w-[55%] lg:max-w-[50%]">
                    <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                      {t(row.contextKey)}
                    </span>
                    <span className="font-display text-base font-bold leading-snug text-pv-text sm:text-lg">
                      {t(row.titleKey)}
                    </span>
                  </div>

                  <div className="flex flex-nowrap items-stretch gap-6 sm:gap-8 md:flex-none md:min-w-[260px] lg:min-w-[300px]">
                    <div className="text-center min-w-[4.5rem]">
                      <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide text-pv-muted">
                        {t(row.col1LabelKey)}
                      </span>
                      <span className="font-display text-lg font-medium tabular-nums text-pv-text sm:text-xl">
                        {row.col1Value}
                      </span>
                    </div>
                    <div className="text-center min-w-[4.5rem]">
                      <span className="mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide text-pv-muted">
                        {t(row.col2LabelKey)}
                      </span>
                      <span className="font-display text-lg font-medium tabular-nums text-pv-text sm:text-xl">
                        {row.col2Value}
                      </span>
                    </div>
                    <div className="text-center min-w-[5.5rem] md:px-1">
                      <span
                        className={`mb-1 block font-mono text-[10px] font-bold uppercase tracking-wide ${
                          row.col3Accent ? "text-pv-emerald" : "text-pv-muted"
                        }`}
                      >
                        {t(row.col3LabelKey)}
                      </span>
                      <span
                        className={`font-display text-lg font-medium sm:text-xl ${
                          row.pulse ? "animate-pulse text-pv-emerald" : ""
                        } ${row.col3Accent ? "text-pv-emerald" : "text-pv-text"}`}
                      >
                        {t(row.col3StateKey)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
      </div>
    </section>
  );
}
