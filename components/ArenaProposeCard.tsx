"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { PlusCircle } from "lucide-react";

export default function ArenaProposeCard() {
  const t = useTranslations("home");

  return (
    <Link
      href="/vs/create"
      className="group flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded border border-pv-emerald/35 bg-pv-emerald p-6 shadow-[0_0_40px_rgba(78,222,163,0.12)] transition-all duration-200 active:scale-[0.98] sm:min-h-[300px] sm:p-8"
    >
      <div className="flex justify-end">
        <PlusCircle
          className="h-10 w-10 text-pv-bg/90 transition-transform duration-200 group-hover:scale-105 sm:h-11 sm:w-11"
          strokeWidth={1.25}
          aria-hidden
        />
      </div>
      <div className="mt-4">
        <h3 className="font-display text-2xl font-bold uppercase leading-[0.95] text-pv-bg sm:text-3xl">
          <span className="block">{t("arenaProposeTitleLine1")}</span>
          <span className="block">{t("arenaProposeTitleLine2")}</span>
        </h3>
        <p className="mt-4 font-mono text-[10px] font-bold uppercase leading-relaxed tracking-[0.22em] text-pv-bg/75 sm:text-[11px]">
          {t("arenaProposeSubtitle")}
        </p>
      </div>
    </Link>
  );
}
