"use client";

import { FilterX } from "lucide-react";

import Button from "@/components/ui/Button";

import ExploreEmptyStateShell from "./ExploreEmptyStateShell";

export type ExploreFilteredEmptyStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  resetLabel: string;
  onReset: () => void;
};

/**
 * Empty state when Arena Live has zero results with active filters.
 */
export default function ExploreFilteredEmptyState({
  eyebrow,
  title,
  description,
  resetLabel,
  onReset,
}: ExploreFilteredEmptyStateProps) {
  return (
    <ExploreEmptyStateShell
      eyebrow={eyebrow}
      title={title}
      description={description}
      icon={
        <FilterX
          className="h-7 w-7 text-pv-emerald sm:h-8 sm:w-8"
          strokeWidth={1.5}
          aria-hidden
        />
      }
      footer={
        <Button
          type="button"
          variant="primary"
          fullWidth
          className="rounded-2xl py-4 font-display text-xs font-bold uppercase tracking-[0.14em] sm:w-auto sm:min-w-[14rem] sm:px-10"
          onClick={onReset}
        >
          {resetLabel}
        </Button>
      }
    />
  );
}
