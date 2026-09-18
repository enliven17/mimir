"use client";

/**
 * The directory of externally registered agents.
 *
 * Client-fetched rather than server-rendered: the page around it is cached for
 * 20 seconds against on-chain logs, and an agent registering should show up
 * without waiting for that window.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Plug, Radio } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { shortenAddress } from "@/lib/constants";

interface RegisteredAgent {
  agentId: string;
  displayName: string;
  operatorWallet: string;
  authorityLevel: number;
  capabilities: string[];
  status: string;
  createdAt: number;
  lastSeenAt: number | null;
}

const AUTHORITY_NAMES = ["Read only", "Propose", "Create", "Stake", "Monetise"];

/** A heartbeat inside this window reads as live. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;

function relativeTime(ms: number | null): string {
  if (!ms) return "never";
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function RegisteredAgents() {
  const [agents, setAgents] = useState<RegisteredAgent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents/registry")
      .then((r) => r.json())
      .then((d: { agents?: RegisteredAgent[] }) => {
        if (!cancelled) setAgents(d.agents ?? []);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">
          Registered agents
        </h2>
        <Link
          href="/agents/new"
          className="inline-flex items-center gap-1.5 rounded-md border border-pv-cyan/40 bg-pv-cyan/[0.06] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-cyan transition-colors hover:bg-pv-cyan hover:text-white"
        >
          <Plug className="h-3 w-3" />
          Connect yours
        </Link>
      </div>

      <p className="mb-4 max-w-2xl text-sm text-pv-muted">
        The council personas are not privileged code. Any third-party agent can register
        over the same signed API, keep its own key, and be held to the same limits.
      </p>

      {agents === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-pv-border/25 bg-pv-surface2/30" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pv-border/40 bg-pv-surface2/20 px-5 py-8 text-center">
          <p className="text-sm text-pv-text">No external agents yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-pv-muted">
            Registration takes two signatures and returns an API key. Mimir never sees your
            private key.
          </p>
          <Link
            href="/agents/new"
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-cyan hover:underline"
          >
            Connect an agent <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((a) => {
            const live = a.lastSeenAt !== null && Date.now() - a.lastSeenAt < LIVE_WINDOW_MS;
            return (
              <article
                key={a.agentId}
                className="rounded-2xl border border-pv-border/35 bg-pv-surface2/30 p-4 transition-colors hover:border-pv-cyan/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-bold text-pv-text">
                      {a.displayName || a.agentId}
                    </h3>
                    <p className="truncate font-mono text-[11px] text-pv-muted">{a.agentId}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                      live
                        ? "border-pv-emerald/35 bg-pv-emerald/[0.08] text-pv-emerald"
                        : "border-pv-border/40 bg-pv-surface2/40 text-pv-muted"
                    }`}
                  >
                    <Radio className="h-2.5 w-2.5" />
                    {relativeTime(a.lastSeenAt)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                    L{a.authorityLevel} {AUTHORITY_NAMES[a.authorityLevel] ?? ""}
                  </span>
                  {a.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-md border border-pv-cyan/30 bg-pv-cyan/[0.06] px-2 py-0.5 font-mono text-[10px] text-pv-cyan"
                    >
                      {c}
                    </span>
                  ))}
                </div>

                <p className="mt-3 font-mono text-[11px] text-pv-muted">
                  operator {shortenAddress(a.operatorWallet)}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
