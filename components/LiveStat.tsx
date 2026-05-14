"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

interface LiveStatProps {
  /** The target number to display */
  value: number;
  /** Format the displayed number */
  format?: (n: number) => string;
  /** Label text above or below the number */
  label?: string;
  /** Label position */
  labelPosition?: "above" | "below";
  /** Prefix (e.g. "$", "Ξ") */
  prefix?: string;
  /** Suffix (e.g. "GEN", "%") */
  suffix?: string;
  /** Duration of the roll animation in seconds */
  duration?: number;
  /** Text size class */
  size?: "sm" | "md" | "lg" | "xl";
  /** Accent color for the number */
  color?: "text" | "cyan" | "fuch" | "emerald" | "gold";
  /** Optional override for the label typography */
  labelClassName?: string;
  className?: string;
}

const sizeClasses = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl sm:text-4xl",
  xl: "text-4xl sm:text-5xl",
};

const colorClasses = {
  text: "text-pv-text",
  cyan: "text-pv-cyan",
  fuch: "text-pv-fuch",
  emerald: "text-pv-emerald",
  gold: "text-pv-gold",
};

/**
 * LiveStat — animated number display that rolls/ticks on mount
 * and pulses briefly when the value updates.
 */
export default function LiveStat({
  value,
  format,
  label,
  labelPosition = "above",
  prefix,
  suffix,
  duration = 1.2,
  size = "md",
  color = "text",
  labelClassName = "",
  className = "",
}: LiveStatProps) {
  const motionValue = useMotionValue(0);
  const [displayValue, setDisplayValue] = useState("0");
  const [pulsing, setPulsing] = useState(false);
  const prevValue = useRef(value);
  const hasAnimated = useRef(false);

  const formatter = format ?? ((n: number) => Math.round(n).toLocaleString());

  useEffect(() => {
    const from = hasAnimated.current ? prevValue.current : 0;
    hasAnimated.current = true;
    prevValue.current = value;

    const controls = animate(motionValue, value, {
      duration,
      ease: [0.25, 0.46, 0.45, 0.94],
      onUpdate: (v) => setDisplayValue(formatter(v)),
    });

    // Pulse on value change (not on first mount)
    if (from !== 0 && from !== value) {
      setPulsing(true);
      const timer = setTimeout(() => setPulsing(false), 400);
      return () => {
        controls.stop();
        clearTimeout(timer);
      };
    }

    return () => controls.stop();
  }, [value, duration]);

  return (
    <div className={`flex flex-col ${className}`}>
      {label && labelPosition === "above" && (
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-pv-muted/60 mb-1 ${labelClassName}`}
        >
          {label}
        </span>
      )}

      <motion.div
        className={`font-display font-bold tabular-nums ${sizeClasses[size]} ${colorClasses[color]} transition-all duration-200`}
        animate={pulsing ? { scale: [1, 1.06, 1], opacity: [1, 0.8, 1] } : {}}
        transition={{ duration: 0.4 }}
      >
        {prefix && <span className="text-pv-muted/50">{prefix}</span>}
        {displayValue}
        {suffix && (
          <span className="text-[0.6em] ml-1 text-pv-muted/60 font-mono font-normal">
            {suffix}
          </span>
        )}
      </motion.div>

      {label && labelPosition === "below" && (
        <span
          className={`font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-pv-muted/60 mt-1 ${labelClassName}`}
        >
          {label}
        </span>
      )}
    </div>
  );
}
