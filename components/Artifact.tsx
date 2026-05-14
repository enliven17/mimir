"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { useMemo } from "react";

interface ArtifactProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  /** Serial number prefix (auto-generated if true, custom if string) */
  serial?: boolean | string;
  /** Watermark text overlay */
  watermark?: string;
  /** Stamp badge in top-right */
  stamp?: React.ReactNode;
  /** Hover lift */
  hoverable?: boolean;
  className?: string;
}

function generateSerial(): string {
  const hex = Math.random().toString(16).slice(2, 10).toUpperCase();
  return `PV-${hex}`;
}

/**
 * Artifact — bordered document / dossier aesthetic.
 *
 * Used for claim tickets, proof logs, records, sealed documents.
 * Monospaced metadata, serial numbers, stamp marks.
 */
export default function Artifact({
  children,
  serial = false,
  watermark,
  stamp,
  hoverable = false,
  className = "",
  ...props
}: ArtifactProps) {
  const serialNumber = useMemo(
    () => (serial === true ? generateSerial() : serial || null),
    [serial]
  );

  return (
    <motion.div
      className={`relative border border-white/[0.12] rounded-lg bg-pv-surface/80 overflow-hidden ${
        hoverable ? "hover:border-white/[0.22] hover:bg-pv-surface/90 cursor-pointer transition-all duration-200" : ""
      } ${className}`}
      whileHover={hoverable ? { y: -2 } : undefined}
      {...props}
    >
      {/* Watermark */}
      {watermark && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
          <span className="font-display text-[72px] sm:text-[96px] font-bold uppercase tracking-[0.15em] text-white/[0.02] rotate-[-12deg]">
            {watermark}
          </span>
        </div>
      )}

      {/* Top bar — serial + stamp */}
      {(serialNumber || stamp) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
          {serialNumber && (
            <span className="font-mono text-[10px] tracking-[0.15em] text-pv-muted/60 uppercase">
              {serialNumber}
            </span>
          )}
          {stamp && <div className="ml-auto">{stamp}</div>}
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 p-4 sm:p-5">{children}</div>

      {/* Bottom edge mark */}
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </motion.div>
  );
}

/** Stamp badge for Artifact — small status indicator */
export function ArtifactStamp({
  label,
  color = "emerald",
}: {
  label: string;
  color?: "cyan" | "fuch" | "emerald" | "gold" | "danger" | "muted";
}) {
  const colorClasses: Record<string, string> = {
    cyan: "text-pv-cyan border-pv-cyan/30",
    fuch: "text-pv-fuch border-pv-fuch/30",
    emerald: "text-pv-emerald border-pv-emerald/30",
    gold: "text-pv-gold border-pv-gold/30",
    danger: "text-pv-danger border-pv-danger/30",
    muted: "text-pv-muted border-pv-muted/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 border rounded font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${colorClasses[color]}`}
    >
      {label}
    </span>
  );
}
