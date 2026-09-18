"use client";

/**
 * The basket directory.
 *
 * Ranked by followers, because that is the number a visitor is actually
 * choosing on. The "nothing is pooled" line is repeated here rather than buried
 * in the docs: a page that looks like a fund should say plainly that it is not.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Layers, Plus, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { shortenAddress } from "@/lib/constants";

interface BasketSummary {
  id: string;
  name: string;
  thesis: string;
  creatorWallet: string;
  members: Array<{ agentId: string; weightBps: number }>;
  followers: number;
  createdAt: number;
}

export default function BasketsClient() {
  const [baskets, setBaskets] = useState<BasketSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/baskets")
      .then((r) => r.json())
      .then((d: { baskets?: BasketSummary[] }) => {
        if (!cancelled) setBaskets(d.baskets ?? []);
      })
      .catch(() => {
        if (!cancelled) setBaskets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pb-16">
      <BlueprintHeading>Agent baskets</BlueprintHeading>

      <div className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-2xl text-center text-sm text-pv-muted">
          A basket is a weighted mix of agents with a stated thesis. Following one is
          mirroring, never depositing: every copied position is staked from your own wallet
          with your own signature. Nothing is pooled and nothing is held.
        </p>

        <div className="mt-6 flex justify-center">
          <Link
            href="/baskets/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.06] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald transition-colors hover:bg-pv-emerald hover:text-white"
          >
            <Plus className="h-3 w-3" />
            Compose a basket
          </Link>
        </div>

        <div className="mt-10">
          {baskets === null ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-[168px] animate-pulse rounded-2xl border border-pv-border/25 bg-pv-surface2/30"
                />
              ))}
            </div>
          ) : baskets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-pv-border/40 bg-pv-surface2/20 px-5 py-12 text-center">
              <Layers className="mx-auto h-5 w-5 text-pv-muted" />
              <p className="mt-3 text-sm text-pv-text">No baskets yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">
                Pick two or more agents, set their weights, and state what the mix is
                betting on. Composing costs nothing and moves nothing.
              </p>
              <Link
                href="/baskets/new"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald hover:underline"
              >
                Compose the first one <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {baskets.map((b) => (
                <Link
                  key={b.id}
                  href={`/baskets/${b.id}`}
                  className="group flex flex-col rounded-2xl border border-pv-border/35 bg-pv-surface2/30 p-5 transition-colors hover:border-pv-emerald/45"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg font-bold tracking-tight text-pv-text">
                        {b.name}
                      </h2>
                      <p className="truncate font-mono text-[11px] text-pv-muted">{b.id}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">
                      <Users className="h-2.5 w-2.5" />
                      {b.followers}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-pv-text/80">
                    {b.thesis}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {b.members.map((m) => (
                      <span
                        key={m.agentId}
                        className="rounded-md border border-pv-border/40 bg-pv-bg/60 px-2 py-0.5 font-mono text-[10px] text-pv-text/80"
                      >
                        {m.agentId}{" "}
                        <span className="text-pv-muted">{(m.weightBps / 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 border-t border-pv-border/30 pt-3 font-mono text-[10px] text-pv-muted">
                    composed by {shortenAddress(b.creatorWallet)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
