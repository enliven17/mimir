"use client";

import { motion } from "framer-motion";
import { tensionLine } from "@/lib/animations/rituals";

interface OppositionLayoutProps {
  sideA: React.ReactNode;
  sideB: React.ReactNode;
  /** Optional center element (e.g. "VS" badge) */
  center?: React.ReactNode;
  /** Intensify glows when both sides are populated */
  active?: boolean;
  className?: string;
}

/**
 * Opposition Visual Grammar — aggressive left/right split.
 *
 * Cyan glow originates from the LEFT (Side A / Creator).
 * Fuchsia glow originates from the RIGHT (Side B / Opponent).
 * A 1px gradient tension line divides them.
 */
export default function OppositionLayout({
  sideA,
  sideB,
  center,
  active = false,
  className = "",
}: OppositionLayoutProps) {
  const intensity = active ? "0.12" : "0.07";

  return (
    <div className={`relative grid grid-cols-[1fr_auto_1fr] items-stretch min-h-[200px] ${className}`}>
      {/* Cyan glow — LEFT */}
      <div
        className="absolute inset-y-0 left-0 w-1/2 pointer-events-none transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 0% 50%, rgba(93,230,255,${intensity}), transparent 70%)`,
        }}
      />

      {/* Fuchsia glow — RIGHT */}
      <div
        className="absolute inset-y-0 right-0 w-1/2 pointer-events-none transition-opacity duration-500"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 100% 50%, rgba(248,172,255,${intensity}), transparent 70%)`,
        }}
      />

      {/* Side A — Creator / Cyan */}
      <div className="relative z-10 flex flex-col justify-center p-6">
        {sideA}
      </div>

      {/* Center tension line */}
      <div className="relative z-10 flex items-center justify-center px-2">
        <motion.div
          className="w-px h-full bg-gradient-to-b from-transparent via-white/30 to-transparent"
          variants={tensionLine}
          initial="idle"
          animate={active ? "active" : "idle"}
        />
        {center && (
          <div className="absolute inset-0 flex items-center justify-center">
            {center}
          </div>
        )}
      </div>

      {/* Side B — Opponent / Fuchsia */}
      <div className="relative z-10 flex flex-col justify-center p-6">
        {sideB}
      </div>
    </div>
  );
}

/** Single-side glow wrapper for when only one side is shown */
export function DirectionalGlow({
  side,
  children,
  className = "",
}: {
  side: "cyan" | "fuch";
  children: React.ReactNode;
  className?: string;
}) {
  const glowClass = side === "cyan" ? "glow-cyan" : "glow-fuch";
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className={`absolute inset-0 ${glowClass} pointer-events-none`} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
