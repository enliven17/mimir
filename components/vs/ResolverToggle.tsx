"use client";

import type { ResolverSpec } from "@/lib/resolver-spec";

/**
 * Offered on the create form when the claim is a single-asset price threshold
 * with Yes/No sides: settle it from price feeds at the deadline, no model.
 */
export default function ResolverToggle({
  spec,
  enabled,
  onChange,
}: {
  spec: Extract<ResolverSpec, { kind: "price" }>;
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-white/[0.10] bg-pv-surface/50 p-4 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#334FA9]"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block font-semibold text-pv-text">Settle deterministically from price feeds</span>
        <span className="mt-1 block text-xs leading-relaxed text-pv-muted">
          YES if {spec.symbol}/USD {spec.op} ${spec.threshold.toLocaleString("en-US")} on CoinGecko, CoinMarketCap and
          Chainlink at the deadline. No AI model decides; sources that disagree mean a refund. Adds a machine-readable
          line to the settlement rule that every challenger can read.
        </span>
      </span>
    </label>
  );
}
