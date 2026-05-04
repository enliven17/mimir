"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

type GlowSide = "cyan" | "fuch" | "both" | "emerald" | "none";

interface GlassCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  glow?: GlowSide;
  hoverable?: boolean;
  noPad?: boolean;
  glass?: boolean;
}

const glowStyles: Record<GlowSide, React.ReactNode> = {
  cyan: (
    <div className="absolute top-0 left-0 w-3/5 h-full glow-cyan pointer-events-none" />
  ),
  fuch: (
    <div className="absolute top-0 right-0 w-3/5 h-full glow-fuch pointer-events-none" />
  ),
  both: (
    <>
      <div className="absolute top-0 left-0 w-1/2 h-full bg-[radial-gradient(ellipse_at_0%_40%,rgba(93,230,255,0.07),transparent_65%)] pointer-events-none" />
      <div className="absolute top-0 right-0 w-1/2 h-full bg-[radial-gradient(ellipse_at_100%_40%,rgba(248,172,255,0.07),transparent_65%)] pointer-events-none" />
    </>
  ),
  emerald: (
    <div className="absolute inset-0 glow-emerald pointer-events-none" />
  ),
  none: null,
};

export default function GlassCard({
  children,
  glow = "none",
  hoverable = false,
  noPad = false,
  glass = false,
  className = "",
  ...props
}: GlassCardProps) {
  const baseClass = glass
    ? "bg-pv-surface/70 backdrop-blur-[20px] border border-white/[0.15] rounded overflow-hidden relative transition-all duration-200"
    : "card";

  return (
    <motion.div
      className={`${baseClass} ${hoverable ? "card-hover cursor-pointer" : ""} ${className}`}
      {...props}
    >
      {glowStyles[glow]}
      <div className={`relative ${noPad ? "" : "p-6"}`}>{children}</div>
    </motion.div>
  );
}
  

