"use client";

import { Swords } from "lucide-react";

import { Link } from "@/i18n/navigation";
import Button from "@/components/ui/Button";

import ExploreEmptyStateShell from "./ExploreEmptyStateShell";

export type ExploreArenaEmptyStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  /** Locale-aware route (e.g. `/vs/create`). */
  ctaHref: string;
};

/**
 * Empty state when Arena Live has no open challenges (no active filters).
 * Visually aligned with {@link ExploreFilteredEmptyState}.
 */
export default function ExploreArenaEmptyState({
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
}: ExploreArenaEmptyStateProps) {
  return (
    <ExploreEmptyStateShell
      eyebrow={eyebrow}
      title={title}
      description={description}
      icon={
        <Swords
          className="h-7 w-7 text-pv-emerald sm:h-8 sm:w-8"
          strokeWidth={1.5}
          aria-hidden
        />
      }
      footer={
        <Link
          href={ctaHref}
          className="block w-full sm:inline-block sm:w-auto"
        >
          <Button
            variant="primary"
            fullWidth
            className="rounded-2xl py-4 font-display text-xs font-bold uppercase tracking-[0.14em] sm:w-auto sm:min-w-[14rem] sm:px-10"
          >
            {ctaLabel}
          </Button>
        </Link>
      }
    />
  );
}
