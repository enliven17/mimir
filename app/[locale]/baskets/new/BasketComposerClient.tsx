"use client";

/**
 * The basket composer.
 *
 * Weights must total exactly 10,000 bps, so the form shows the running total
 * and what is left rather than letting someone submit into a rejection. The
 * same rules run server-side; this is a courtesy, not the enforcement.
 */

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Check, Plus, Scale, TriangleAlert, X } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import {
  composeMessage,
  DEFAULT_BASKET_POLICY,
  WEIGHT_TOTAL_BPS,
  type BasketMember,
} from "@/lib/baskets";

interface Candidate {
  agentId: string;
  label: string;
  kind: "persona" | "agent";
}

export default function BasketComposerClient() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [members, setMembers] = useState<BasketMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/council/roster").then((r) => (r.ok ? r.json() : { personas: [] })).catch(() => ({ personas: [] })),
      fetch("/api/agents/registry").then((r) => (r.ok ? r.json() : { agents: [] })).catch(() => ({ agents: [] })),
    ]).then(([roster, registry]) => {
      if (cancelled) return;
      const personas: Candidate[] = (roster.personas ?? []).map(
        (p: { slug: string; displayName: string; emoji: string }) => ({
          agentId: p.slug,
          label: `${p.emoji} ${p.displayName}`,
          kind: "persona" as const,
        }),
      );
      const agents: Candidate[] = (registry.agents ?? []).map(
        (a: { agentId: string; displayName: string }) => ({
          agentId: a.agentId,
          label: a.displayName || a.agentId,
          kind: "agent" as const,
        }),
      );
      setCandidates([...personas, ...agents]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalBps = useMemo(() => members.reduce((a, m) => a + m.weightBps, 0), [members]);
  const remaining = WEIGHT_TOTAL_BPS - totalBps;
  const overCap = members.find((m) => m.weightBps > DEFAULT_BASKET_POLICY.maxSingleAgentBps);

  const ready =
    isConnected &&
    /^[a-z0-9][a-z0-9-]{2,63}$/.test(id) &&
    name.trim().length > 0 &&
    thesis.trim().length > 0 &&
    members.length >= DEFAULT_BASKET_POLICY.minMembers &&
    remaining === 0 &&
    !overCap;

  function addMember(agentId: string) {
    if (members.some((m) => m.agentId === agentId)) return;
    if (members.length >= DEFAULT_BASKET_POLICY.maxMembers) return;
    // Split evenly on add: the common case is an equal-weight basket, and the
    // remainder goes to the first leg so the total always lands on 10,000.
    const next = [...members, { agentId, weightBps: 0 }];
    const even = Math.floor(WEIGHT_TOTAL_BPS / next.length);
    const balanced = next.map((m, i) => ({
      ...m,
      weightBps: i === 0 ? WEIGHT_TOTAL_BPS - even * (next.length - 1) : even,
    }));
    setMembers(balanced);
  }

  function removeMember(agentId: string) {
    setMembers((prev) => prev.filter((m) => m.agentId !== agentId));
  }

  function setWeight(agentId: string, percent: number) {
    setMembers((prev) =>
      prev.map((m) => (m.agentId === agentId ? { ...m, weightBps: Math.round(percent * 100) } : m)),
    );
  }

  async function publish() {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      const signature = await signMessageAsync({
        message: composeMessage(id, name.trim(), members),
      });
      const res = await fetch("/api/baskets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          name: name.trim(),
          thesis: thesis.trim(),
          creatorWallet: address,
          members,
          signature,
        }),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(payload.message ?? `HTTP ${res.status}`));
      router.push(`/baskets/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not publish the basket");
      setBusy(false);
    }
  }

  const available = candidates.filter((c) => !members.some((m) => m.agentId === c.agentId));

  return (
    <div className="pb-16">
      <BlueprintHeading>Compose a basket</BlueprintHeading>

      <div className="mx-auto max-w-[820px] px-4 pt-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-xl text-center text-sm text-pv-muted">
          Pick the agents, set the weights, state what the mix is betting on. Publishing
          costs nothing and moves nothing: a basket is a thesis, not a fund.
        </p>

        <div className="mt-8 space-y-6">
          <section className="card rounded-2xl p-5">
            <h2 className="label">Identity</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="basket-id" className="label">Basket id</label>
                <input
                  id="basket-id"
                  className="form-field-pv font-mono"
                  placeholder="contrarian-mix"
                  value={id}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setId(e.target.value.toLowerCase().trim())}
                />
              </div>
              <div>
                <label htmlFor="basket-name" className="label">Name</label>
                <input
                  id="basket-name"
                  className="form-field-pv"
                  placeholder="Contrarian mix"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="basket-thesis" className="label">Thesis</label>
              <textarea
                id="basket-thesis"
                className="form-field-pv min-h-[88px] resize-y"
                placeholder="What does this mix believe, and why these agents?"
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
              />
            </div>
          </section>

          <section className="card rounded-2xl p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="label mb-0">Members</h2>
              <span
                className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
                  remaining === 0 ? "text-pv-emerald" : "text-pv-muted"
                }`}
              >
                {remaining === 0
                  ? "100% allocated"
                  : remaining > 0
                    ? `${(remaining / 100).toFixed(2)}% left`
                    : `${(-remaining / 100).toFixed(2)}% over`}
              </span>
            </div>

            {members.length === 0 ? (
              <p className="rounded-xl border border-dashed border-pv-border/40 px-4 py-6 text-center text-[12px] text-pv-muted">
                Add at least {DEFAULT_BASKET_POLICY.minMembers} agents.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => {
                  const label = candidates.find((c) => c.agentId === m.agentId)?.label ?? m.agentId;
                  const over = m.weightBps > DEFAULT_BASKET_POLICY.maxSingleAgentBps;
                  return (
                    <li
                      key={m.agentId}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-pv-border/35 bg-pv-surface2/30 px-3.5 py-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-pv-text">{label}</span>
                      <label className="sr-only" htmlFor={`w-${m.agentId}`}>
                        {m.agentId} weight
                      </label>
                      <input
                        id={`w-${m.agentId}`}
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={m.weightBps / 100}
                        onChange={(e) => setWeight(m.agentId, Number(e.target.value))}
                        className={`w-20 rounded-lg border bg-pv-bg/80 px-2 py-1.5 text-right font-mono text-sm tabular-nums text-pv-text outline-none ${
                          over ? "border-pv-danger/60" : "border-pv-border/40"
                        }`}
                      />
                      <span className="font-mono text-[11px] text-pv-muted">%</span>
                      <button
                        type="button"
                        onClick={() => removeMember(m.agentId)}
                        aria-label={`Remove ${m.agentId}`}
                        className="rounded-lg border border-pv-border/40 p-1.5 text-pv-muted transition-colors hover:border-pv-danger/50 hover:text-pv-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {overCap && (
              <p className="mt-3 flex items-center gap-2 text-[12px] text-pv-danger">
                <Scale className="h-3.5 w-3.5 shrink-0" />
                No single agent may hold more than{" "}
                {DEFAULT_BASKET_POLICY.maxSingleAgentBps / 100}% of a basket.
              </p>
            )}

            {available.length > 0 && members.length < DEFAULT_BASKET_POLICY.maxMembers && (
              <div className="mt-4">
                <p className="label">Add an agent</p>
                <div className="flex flex-wrap gap-1.5">
                  {available.map((c) => (
                    <button
                      key={c.agentId}
                      type="button"
                      onClick={() => addMember(c.agentId)}
                      className="inline-flex items-center gap-1 rounded-md border border-pv-border/40 bg-pv-bg/60 px-2.5 py-1 text-[12px] text-pv-text/85 transition-colors hover:border-pv-emerald/45 hover:text-pv-text"
                    >
                      <Plus className="h-3 w-3 text-pv-muted" />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-pv-danger/30 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <button
            type="button"
            className="btn-primary flex items-center justify-center gap-2"
            disabled={!ready || busy}
            onClick={() => void publish()}
          >
            {busy ? "Waiting for signature…" : "Sign and publish"}
            {!busy && <Check className="h-4 w-4" />}
          </button>
          {!isConnected && (
            <p className="text-center text-[12px] text-pv-muted">Connect a wallet to publish.</p>
          )}
        </div>
      </div>
    </div>
  );
}
