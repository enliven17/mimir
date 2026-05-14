"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { PlusCircle } from "lucide-react";
import { getVSChallengerCount, getVSTotalPot, type VSData } from "@/lib/contract";
import { Button } from "@/components/ui";

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

  const feedRows: FeedRow[] = useMemo(() => {
    const live = allVS.slice(0, 3).map((vs) => ({ kind: "live" as const, vs }));
    if (live.length > 0) return live;
    return [
      {
        kind: "demo",
        id: "demo-1",
        contextKey: "archiveDemo1Ctx",
        titleKey: "archiveDemo1Title",
        col1LabelKey: "archiveColPool",
        col1Value: "12 GEN",
        col2LabelKey: "archiveColChallengers",
        col2Value: "7",
        col3LabelKey: "archiveColState",
        col3StateKey: "archiveStateOpen",
      },
      {
        kind: "demo",
        id: "demo-2",
        contextKey: "archiveDemo2Ctx",
        titleKey: "archiveDemo2Title",
        col1LabelKey: "archiveColPool",
        col1Value: "24 GEN",
        col2LabelKey: "archiveColChallengers",
        col2Value: "2",
        col3LabelKey: "archiveColState",
        col3StateKey: "archiveStateLive",
        col3Accent: true,
      },
      {
        kind: "demo",
        id: "demo-3",
        contextKey: "archiveDemo3Ctx",
        titleKey: "archiveDemo3Title",
        col1LabelKey: "archiveColPool",
        col1Value: "8 GEN",
        col2LabelKey: "archiveColChallengers",
        col2Value: "11",
        col3LabelKey: "archiveColState",
        col3StateKey: "archiveStateOpen",
        pulse: true,
      },
    ];
  }, [allVS]);

  return (
    <section
      className="mb-12 border-t border-white/[0.06] pt-14 sm:mb-16 sm:pt-16 md:pt-20"
      aria-labelledby="settlement-archive-heading"
    >
      {/* Header + headline stats */}
      <div className="mb-14 flex flex-col justify-between gap-10 md:mb-16 md:flex-row md:items-end md:gap-12 lg:mb-20">
        <div className="max-w-2xl">
          <span className="mb-4 block font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
            {t("archiveEyebrow")}
          </span>
          <h2
            id="settlement-archive-heading"
            className="mb-5 font-display text-[clamp(2.25rem,6vw,3.75rem)] font-bold leading-[0.95] tracking-tighter text-pv-text"
          >
            {t("archiveTitle")}
          </h2>
          <p className="max-w-md text-base font-light leading-relaxed text-pv-muted sm:text-lg">
            {t("archiveLead")}
          </p>
        </div>

        <div
          className={`flex flex-wrap gap-10 sm:gap-14 md:mb-1 ${loading ? "opacity-60" : ""}`}
          aria-busy={loading}
        >
          <div>
            <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
              {t("archiveStatTotalPool")}
            </span>
            <span
              className="font-display text-3xl font-medium tabular-nums tracking-tighter text-pv-text sm:text-4xl"
              style={{ textShadow: "0 0 24px rgba(78, 222, 163, 0.22)" }}
            >
              {loading ? "—" : `${totalPool} GEN`}
            </span>
          </div>
          <div>
            <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
              {t("archiveStatOpenChallenges")}
            </span>
            <span className="font-display text-3xl font-medium tabular-nums tracking-tighter text-pv-emerald sm:text-4xl">
              {loading ? "—" : openCount}
            </span>
          </div>
        </div>
      </div>

      {/* Glass insight panel */}
      <div className="group relative mb-14 overflow-hidden rounded-lg border border-white/[0.12] bg-pv-surface/80 px-6 py-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:mb-16 sm:p-10 md:p-12 lg:mb-20">
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

      {/* Terminal feed */}
      <div>
        <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="border-l-2 border-pv-emerald pl-4 font-display text-lg font-bold uppercase tracking-tight text-pv-text sm:text-xl">
            {t("archiveTerminalTitle")}
          </h3>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted">
            {t("archiveTerminalMeta", { count: allVS.length })}
          </span>
        </div>

        <div className="flex flex-col gap-3 sm:gap-4">
          {feedRows.map((row) =>
            row.kind === "live" ? (
              <Link
                key={row.vs.id}
                href={`/vs/${row.vs.id}`}
                className="group flex gap-6 border border-transparent bg-[#131313] p-5 transition-all duration-300 hover:border-pv-emerald/20 hover:bg-pv-surface md:flex-row md:flex-nowrap md:items-center md:justify-between md:gap-8 md:p-6"
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
                        {getVSTotalPot(row.vs)}
                        <span className="ml-0.5 text-sm font-normal text-pv-muted">GEN</span>
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
                className="group flex gap-6 border border-white/[0.06] bg-[#131313] p-5 transition-all duration-300 hover:border-pv-emerald/20 hover:bg-pv-surface md:flex-row md:flex-nowrap md:items-center md:justify-between md:gap-8 md:p-6"
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
      </div>
    </section>
  );
}
