"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

interface StageProps extends Omit<HTMLMotionProps<"section">, "children"> {
  children: React.ReactNode;
  /** Ambient glow direction */
  glow?: "cyan" | "fuch" | "both" | "emerald" | "none";
  /** Extra immersion: perspective grid floor lines */
  grid?: boolean;
  className?: string;
}

const glowMap: Record<string, string> = {
  cyan: "radial-gradient(ellipse 70% 50% at 0% 50%, rgba(93,230,255,0.08), transparent 70%)",
  fuch: "radial-gradient(ellipse 70% 50% at 100% 50%, rgba(248,172,255,0.08), transparent 70%)",
  both: "radial-gradient(ellipse 60% 40% at 0% 30%, rgba(93,230,255,0.08), transparent 70%), radial-gradient(ellipse 60% 40% at 100% 70%, rgba(248,172,255,0.08), transparent 70%)",
  emerald: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(78,222,163,0.06), transparent 70%)",
  none: "none",
};

/**
 * Stage — immersive, full-bleed hero container.
 *
 * Used for VS displays, resolution moments, hero areas.
 * Minimal chrome, environmental lighting, cinematic presence.
 */
export default function Stage({
  children,
  glow = "both",
  grid = false,
  className = "",
  ...props
}: StageProps) {
  return (
    <motion.section
      className={`relative overflow-hidden rounded-2xl ${className}`}
      {...props}
    >
      {/* Environmental lighting */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: glowMap[glow] }}
      />

      {/* Perspective grid floor (optional) */}
      {grid && (
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)
            `,
            backgroundSize: "60px 60px",
            transform: "perspective(500px) rotateX(45deg)",
            transformOrigin: "bottom center",
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </motion.section>
  );
}
