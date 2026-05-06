"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import GlassCard from "./ui/GlassCard";

interface ProvenStampProps {
  title: string;
  amountLabel?: string | null;
  resolutionSummary?: string;
  resultTone?: "win" | "lost";
}

export default function ProvenStamp({
  title,
  amountLabel,
  resolutionSummary,
  resultTone = "win",
}: ProvenStampProps) {
  const t = useTranslations("stamp");

  const addrMatch = title.match(/(0x[0-9a-fA-F]+(?:…[0-9a-fA-F]+)?)/);

  return (
    <GlassCard
      glass
      glow="both"
      noPad
      className="animate-pulse-glow mb-6 !rounded-2xl border border-white/[0.12]"
    >
      <div className="p-5 sm:p-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald/90 mb-8 sm:mb-8"
        >
          {t("provenDecided")}
        </motion.div>

        {/* Monolithic stamp */}
        <motion.div
          initial={{ opacity: 0, scale: 2.3, rotate: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: -10 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="inline-flex items-center justify-center rounded-xl border-[3px] border-pv-emerald bg-pv-emerald/[0.05] px-10 py-3 font-display text-2xl font-bold uppercase tracking-widest text-pv-emerald shadow-glow-emerald mb-7 sm:text-3xl"
        >
          PROVEN.
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          className="font-display text-[18px] sm:text-2xl font-bold tracking-tight mb-3"
        >
          {addrMatch ? (
            <>
              {title.slice(0, addrMatch.index).trimEnd()}{" "}
              <span className="font-mono text-[16px] sm:text-[17px] font-bold text-pv-emerald/90">
                {addrMatch[1]}
              </span>
            </>
          ) : (
            title
          )}
        </motion.h2>

        {amountLabel ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className={
              resultTone === "lost"
                ? "mx-auto mt-1 font-mono text-[24px] sm:text-3xl font-bold text-pv-danger [text-shadow:0_0_20px_rgba(239,68,68,0.45)]"
                : "mx-auto mt-1 font-mono text-[24px] sm:text-3xl font-bold text-pv-gold [text-shadow:0_0_20px_rgba(251,191,36,0.4)]"
            }
          >
            {amountLabel}
          </motion.div>
        ) : null}

        {resolutionSummary ? (
          <>
            <div className="my-4 h-px bg-white/[0.08]" aria-hidden />
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="mx-auto max-w-[52ch] text-[11px] sm:text-xs text-pv-muted leading-relaxed"
            >
              {resolutionSummary}
            </motion.p>
          </>
        ) : null}
      </div>
    </GlassCard>
  );
}
