"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

interface ControlPanelProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  /** Optional panel label */
  label?: string;
  /** Recessed visual depth */
  recessed?: boolean;
  className?: string;
}

/**
 * ControlPanel — tactical/console aesthetic for filters, inputs, settings.
 *
 * Recessed appearance, segmented layout, monospaced accents.
 */
export default function ControlPanel({
  children,
  label,
  recessed = true,
  className = "",
  ...props
}: ControlPanelProps) {
  return (
    <motion.div
      className={`relative rounded-xl overflow-hidden ${
        recessed
          ? "bg-pv-bg/80 border border-white/[0.08] shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]"
          : "bg-pv-surface border border-white/[0.12]"
      } ${className}`}
      {...props}
    >
      {label && (
        <div className="px-4 py-2 border-b border-white/[0.06]">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted/50">
            {label}
          </span>
        </div>
      )}
      <div className="p-4">{children}</div>
    </motion.div>
  );
}

/** Segmented toggle switch for ControlPanel */
export function SegmentedSwitch({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex rounded-lg bg-pv-bg/60 border border-white/[0.08] p-0.5 ${className}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`relative px-3 py-1.5 rounded-md font-mono text-[11px] font-bold uppercase tracking-wider transition-all duration-150 ${
            value === opt.value
              ? "bg-white/[0.08] text-pv-text shadow-sm"
              : "text-pv-muted hover:text-pv-text/70"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Data badge for ControlPanel — small metric display */
export function DataBadge({
  label,
  value,
  color = "muted",
}: {
  label: string;
  value: string | number;
  color?: "cyan" | "fuch" | "emerald" | "gold" | "muted";
}) {
  const textColor: Record<string, string> = {
    cyan: "text-pv-cyan",
    fuch: "text-pv-fuch",
    emerald: "text-pv-emerald",
    gold: "text-pv-gold",
    muted: "text-pv-muted",
  };

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-pv-muted/50">
        {label}
      </span>
      <span className={`font-mono text-sm font-bold ${textColor[color]}`}>
        {value}
      </span>
    </div>
  );
}
