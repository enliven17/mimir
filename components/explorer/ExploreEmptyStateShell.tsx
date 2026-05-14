"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export type ExploreEmptyStateShellProps = {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  footer: ReactNode;
  /** When true, announces updates to assistive tech (empty-state content). */
  announce?: boolean;
};

/**
 * Shared glass panel + typography for explorer empty states (filters, open arena).
 * Mobile-first; matches `arena-controls` panels in ExploreClient.
 */
export default function ExploreEmptyStateShell({
  icon,
  eyebrow,
  title,
  description,
  footer,
  announce = true,
}: ExploreEmptyStateShellProps) {
  return (
    <motion.div
      {...(announce
        ? { role: "status" as const, "aria-live": "polite" as const }
        : {})}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="mx-auto w-full max-w-[min(100%,28rem)] sm:max-w-xl"
    >
      <div className="relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-5 py-10 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:rounded-[28px] sm:px-8 sm:py-12">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
          aria-hidden
        />
        <div className="relative flex flex-col items-center text-center">
          <div
            className="mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-pv-emerald/25 bg-pv-emerald/[0.08] sm:mb-6 sm:h-16 sm:w-16"
            aria-hidden
          >
            {icon}
          </div>
          {eyebrow ? (
            <p className="max-w-full font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-muted sm:text-[11px] sm:tracking-[0.22em]">
              {eyebrow}
            </p>
          ) : null}
          <h3
            className={`font-display text-lg font-bold uppercase leading-snug tracking-tight text-pv-text sm:text-xl md:text-2xl ${eyebrow ? "mt-2 sm:mt-2.5" : "mt-0"}`}
          >
            {title}
          </h3>
          <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-pv-muted sm:mt-4 sm:text-base">
            {description}
          </p>
          <div className="mt-8 w-full sm:mt-9 sm:flex sm:justify-center">
            {footer}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
