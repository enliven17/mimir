"use client";

import { Link } from "@/i18n/navigation";
import type { ChainKey } from "@/lib/chains";
import type { VSData } from "@/lib/contract";
import { confidenceTier, settlementPreview, type ConfidenceTier } from "@/lib/settlement-preview";

const TIER: Record<ConfidenceTier, { label: string; hint: string; className: string }> = {
  deterministic: {
    label: "Deterministic",
    hint: "Settled by the structured resolver from data, not by a model.",
    className: "border-emerald-400/35 bg-emerald-400/[0.08] text-emerald-100",
  },
  firm: {
    label: "Firm",
    hint: "The oracle was at least 80% confident on unambiguous evidence.",
    className: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-100",
  },
  contested: {
    label: "Contested",
    hint: "Settled, but on weaker evidence (60-79% confidence or scraped sources).",
    className: "border-amber-400/35 bg-amber-400/[0.08] text-amber-100",
  },
  refunded: {
    label: "Refunded",
    hint: "The evidence did not determine the outcome, so every stake was returned.",
    className: "border-white/[0.14] bg-white/[0.04] text-pv-text/85",
  },
};

/**
 * Before settlement: how this claim will be decided. After: how firm the
 * verdict was, and a link to its audit record.
 */
export default function SettlementPreviewCard({ vs, chain }: { vs: VSData; chain: ChainKey }) {
  const resolved = vs.state === "resolved";
  const preview = settlementPreview({
    question: vs.question,
    settlementRule: vs.settlement_rule,
    resolutionUrl: vs.resolution_url,
    category: vs.category,
    deadline: vs.deadline,
  });
  const tier = resolved ? TIER[confidenceTier(vs.winner_side, vs.confidence, vs.resolution_summary ?? "")] : null;

  return (
    <section className="rounded-xl border border-white/[0.10] bg-pv-surface/50 p-4 sm:p-5" aria-label="How this claim settles">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-pv-muted">
          {resolved ? "How it was settled" : "How this claim will settle"}
        </h3>
        {tier ? (
          <span className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] ${tier.className}`} title={tier.hint}>
            {tier.label}
            {typeof vs.confidence === "number" && vs.confidence > 0 ? ` · ${vs.confidence}%` : ""}
          </span>
        ) : null}
      </div>
      {tier ? <p className="mb-3 text-xs text-pv-muted">{tier.hint}</p> : null}
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-pv-text/90">
        {preview.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      {resolved ? (
        <Link
          href={`/verify/${vs.id}${chain === "arc" ? "" : `?chain=${chain}`}`}
          className="mt-4 inline-flex text-sm font-semibold text-pv-text underline decoration-pv-emerald/60 underline-offset-4 hover:decoration-pv-emerald"
        >
          Verify this verdict →
        </Link>
      ) : null}
    </section>
  );
}
