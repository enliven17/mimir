"use client";

import { useTranslations } from "next-intl";
import { BlueprintHeading } from "@/components/BlueprintGrid";

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

  const subtitle = isFeatureOff ? t("featureOffLead") : t("subtitle");

  return (
    <header className={`${className}`.trim()}>
      <BlueprintHeading>{t("title")}</BlueprintHeading>
      <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-relaxed text-pv-muted sm:text-[15px]">
        {subtitle}
      </p>
    </header>
  );
}
