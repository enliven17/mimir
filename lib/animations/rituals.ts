/**
 * Ritual Animation System — PROVEN protocol motion primitives.
 *
 * All animations use Framer Motion variants so they can be composed with
 * <motion.div variants={sealStamp}> or used imperatively via animate().
 */

import type { Variants, Transition } from "framer-motion";

/* ── Shared easings ── */
export const PROVEN_EASE = [0.25, 0.46, 0.45, 0.94] as const;
export const SNAP_EASE = [0.22, 1, 0.36, 1] as const;

/* ─────────────────────────────────────────────
   1. Seal Stamp — challenge creation / claim issued
   Subtle scale-in + opacity flash
   ───────────────────────────────────────────── */
export const sealStamp: Variants = {
  hidden: { opacity: 0, scale: 1.8, rotate: -8 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: -8,
    transition: { duration: 0.55, ease: PROVEN_EASE },
  },
  exit: { opacity: 0, scale: 0.9, transition: { duration: 0.2 } },
};

export const sealFlash: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: [0, 0.6, 0],
    transition: { duration: 0.6, times: [0, 0.15, 1] },
  },
};

/* ─────────────────────────────────────────────
   2. Fuse Countdown — decaying progress bar with pulse
   Used on all deadline displays
   ───────────────────────────────────────────── */
export const fusePulse: Variants = {
  idle: { opacity: 1 },
  urgent: {
    opacity: [1, 0.6, 1],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
  critical: {
    opacity: [1, 0.4, 1],
    transition: { duration: 0.6, repeat: Infinity, ease: "easeInOut" },
  },
};

export const fuseBarDecay = (progress: number): Variants => ({
  initial: { scaleX: 1, transformOrigin: "left" },
  animate: {
    scaleX: progress,
    transition: { duration: 0.8, ease: PROVEN_EASE },
  },
});

/* ─────────────────────────────────────────────
   3. Phase Shift — status transition animation
   Color wash + text morph for OPEN → LOCKED → VERIFYING → PROVEN
   ───────────────────────────────────────────── */
export const PHASE_COLORS = {
  open: "rgba(93, 230, 255, 0.15)",
  locked: "rgba(248, 172, 255, 0.15)",
  verifying: "rgba(251, 191, 36, 0.15)",
  proven: "rgba(78, 222, 163, 0.15)",
} as const;

export const phaseShift: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.4, ease: PROVEN_EASE },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: "blur(4px)",
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

export const phaseWash: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: PROVEN_EASE },
  },
};

/* ─────────────────────────────────────────────
   4. Verdict Reveal — full-width overlay moment
   Brief pause → result. Finality, not celebration.
   ───────────────────────────────────────────── */
export const verdictOverlay: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease: "easeOut" },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.4, delay: 0.1, ease: "easeIn" },
  },
};

export const verdictWord: Variants = {
  hidden: { opacity: 0, scale: 1.6, letterSpacing: "0.5em" },
  visible: {
    opacity: 1,
    scale: 1,
    letterSpacing: "0.2em",
    transition: { duration: 0.7, delay: 0.35, ease: SNAP_EASE },
  },
};

export const verdictResult: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: 0.9, ease: PROVEN_EASE },
  },
};

/* ─────────────────────────────────────────────
   5. Utility primitives — reusable across components
   ───────────────────────────────────────────── */

/** Kinetic text reveal — letter-by-letter or word-by-word */
export const kineticContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
};

export const kineticLetter: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: PROVEN_EASE },
  },
};

/** Stagger children with configurable delay */
export const staggerContainer = (
  stagger = 0.07,
  delay = 0.02
): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: PROVEN_EASE },
  },
};

/** Slide-in from direction */
export const slideIn = (
  direction: "left" | "right" | "up" | "down",
  distance = 40
): Variants => {
  const isHorizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const offset = distance * sign;
  if (isHorizontal) {
    return {
      hidden: { opacity: 0, x: offset },
      visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: PROVEN_EASE } },
    };
  }
  return {
    hidden: { opacity: 0, y: offset },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: PROVEN_EASE } },
  };
};

/** Number roll transition for LiveStat */
export const numberRoll: Transition = {
  type: "spring",
  stiffness: 100,
  damping: 20,
  mass: 0.8,
};

/** Intensity pulse — used when new on-chain activity occurs */
export const activityPulse: Variants = {
  idle: { scale: 1, opacity: 1 },
  pulse: {
    scale: [1, 1.05, 1],
    opacity: [1, 0.8, 1],
    transition: { duration: 0.4, ease: "easeOut" },
  },
};

/** Opposition tension — center line intensification */
export const tensionLine: Variants = {
  idle: { opacity: 0.3 },
  active: {
    opacity: [0.3, 0.7, 0.3],
    transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
  },
};
