"use client";

import { useTranslations } from "next-intl";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";

export default function EmergingNarrativesClient() {
  const t = useTranslations("emergingNarratives");

  return (
    <PageTransition>
      <AnimatedItem>
        <div className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-4 sm:gap-6">
              <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
                <h1 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
                  {t("title")}
                </h1>
                <div className="h-px min-w-[2rem] flex-1 bg-white/[0.12]" aria-hidden />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="block max-w-2xl font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
                {t("lead")}
              </span>
            </div>
          </div>

          <div className="card border-white/[0.12] bg-pv-surface/60 p-10 text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:p-12">
            <div className="font-display text-xl font-bold uppercase tracking-[0.08em] text-pv-text sm:text-2xl">
              {t("comingSoon")}
            </div>
          </div>
        </div>
      </AnimatedItem>
    </PageTransition>
  );
}

