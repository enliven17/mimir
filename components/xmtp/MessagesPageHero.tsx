"use client";

import { useTranslations } from "next-intl";

export type MessagesPageHeroVariant = "default" | "featureOff";

type MessagesPageHeroProps = {
  variant?: MessagesPageHeroVariant;
  className?: string;
};

/**
 * Hero compartido: orden semántico eyebrow → H1 → subtítulo, alineado con Dashboard / Arena.
 * Mobile-first: línea decorativa solo desde `sm` para no apretar el título en viewports angostos.
 */
export default function MessagesPageHero({
  variant = "default",
  className = "",
}: MessagesPageHeroProps) {
  const t = useTranslations("messagesHub");
  const isFeatureOff = variant === "featureOff";

  const eyebrow = isFeatureOff ? t("featureOffEyebrow") : t("eyebrow");
  const subtitle = isFeatureOff ? t("featureOffLead") : t("subtitle");

  return (
    <header className={`${className}`.trim()}>
      <p className="mb-3 max-w-2xl font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-pv-emerald sm:mb-4 sm:text-xs sm:tracking-[0.28em]">
        {eyebrow}
      </p>
      <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-4 sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
          <h1 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
            {t("title")}
          </h1>
          <div
            className="hidden h-px min-w-[2rem] flex-1 bg-white/[0.12] sm:block"
            aria-hidden
          />
        </div>
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-pv-muted sm:text-[15px]">
        {subtitle}
      </p>
    </header>
  );
}
