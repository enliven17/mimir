"use client";

import { useCountdown } from "@/lib/hooks";

interface CountdownTimerProps {
  deadline: number;
  className?: string;
}

export default function CountdownTimer({
  deadline,
  className = "",
}: CountdownTimerProps) {
  const { text, expired } = useCountdown(deadline);

  return (
    <span
      className={`font-mono font-bold tabular-nums ${
        expired ? "text-pv-gold" : "text-pv-text"
      } ${className}`}
      role="timer"
      aria-live="polite"
    >
      {text}
    </span>
  );
}
