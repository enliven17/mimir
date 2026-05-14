"use client";

import { useEffect, useId, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui";

export type CreateMockOverlayPhase = "closed" | "loading" | "success";

type CreateMockFundingOverlayProps = {
  phase: CreateMockOverlayPhase;
  titleLoading: string;
  hintLoading: string;
  titleSuccess: string;
  subtitleSuccess: string;
};

/**
 * Overlay de demostración: fondeo simulado → éxito (sin llamadas al contrato).
 */
export default function CreateMockFundingOverlay({
  phase,
  titleLoading,
  hintLoading,
  titleSuccess,
  subtitleSuccess,
}: CreateMockFundingOverlayProps) {
  const open = phase !== "closed";
  const titleId = useId();
  const descId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      document.getElementById(titleId)?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, titleId]);

  useEffect(() => {
    if (open) {
      return;
    }
    previouslyFocused.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="presentation"
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="absolute inset-0 bg-pv-bg/80 backdrop-blur-md"
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative z-[1] w-full max-w-md"
          >
            <GlassCard
              glass
              noPad
              glow="emerald"
              className="!rounded-2xl border border-white/[0.14] shadow-[0_0_48px_-12px_rgba(78,222,163,0.35)]"
            >
              <div className="p-6 sm:p-8">
                <div
                  id={descId}
                  className="sr-only"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {phase === "loading"
                    ? `${titleLoading}. ${hintLoading}`
                    : `${titleSuccess}. ${subtitleSuccess}`}
                </div>

                {phase === "loading" ? (
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.08]">
                      <Loader2
                        className="size-7 animate-spin text-pv-emerald"
                        aria-hidden
                      />
                    </div>
                    <h2
                      id={titleId}
                      tabIndex={-1}
                      className="font-display text-lg font-bold uppercase tracking-tight text-pv-text sm:text-xl outline-none"
                    >
                      {titleLoading}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-pv-muted">
                      {hintLoading}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.08] shadow-[0_0_28px_-10px_rgba(78,222,163,0.5)]">
                      <Check
                        className="size-7 text-pv-emerald"
                        strokeWidth={2.5}
                        aria-hidden
                      />
                    </div>
                    <h2
                      id={titleId}
                      tabIndex={-1}
                      className="font-display text-lg font-bold uppercase tracking-tight text-pv-text sm:text-xl outline-none"
                    >
                      {titleSuccess}
                    </h2>
                    <p className="mt-3 text-sm leading-relaxed text-pv-muted">
                      {subtitleSuccess}
                    </p>
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
