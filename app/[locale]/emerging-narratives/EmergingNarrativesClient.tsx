"use client";

import { useTranslations } from "next-intl";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { BlueprintHeading } from "@/components/BlueprintGrid";

export default function EmergingNarrativesClient() {
  const t = useTranslations("emergingNarratives");

  return (
    <PageTransition>
      <AnimatedItem>
        <div className="pb-8">
          <BlueprintHeading>{t("title")}</BlueprintHeading>
          <div className="px-4 pt-6 sm:px-6 lg:px-8">
          <div className="mb-10">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="block max-w-2xl text-center font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
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
        </div>
      </AnimatedItem>
    </PageTransition>
  );
}

