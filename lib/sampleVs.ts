import type { VSData } from "@/lib/contract";

/**
 * Demo VS data was used to seed the UI before real on-chain markets existed.
 * Now empty — the homepage, explorer, and detail pages render only real claims
 * read from the Arc contract / Neon read-index.
 *
 * The negative-id branches scattered through vs/[id]/page.tsx are dead at
 * runtime (no negative ids ever match) but kept in place to avoid a noisy
 * mechanical refactor across that file.
 */
export const SAMPLE_VS: Record<number, VSData> = {};

export const EXPLORE_SAMPLE_ORDER = [] as const;

export function getExploreSampleCards(): VSData[] {
  return [];
}
