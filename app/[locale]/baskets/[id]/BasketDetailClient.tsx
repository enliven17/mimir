"use client";

/**
 * One basket: its thesis, its legs, its replayed curve, and the follow control.
 *
 * The curve is drawn as an inline SVG sparkline rather than pulling in a chart
 * library for one line. The caveat under it is deliberate and permanent: the
 * curve is a projection of settled markets, not a record of anyone's money.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { Check, Info, TriangleAlert, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { followMessage } from "@/lib/baskets";
import { shortenAddress } from "@/lib/constants";

interface Member {
  agentId: string;
  weightBps: number;
  wallet: string | null;
  idle: boolean;
}

interface Point {
  day: string;
  navUsdc: string;
  dailyReturn: number;
  drawdown: number;
}

interface BasketDetail {
  basket: {
    id: string;
    name: string;
    thesis: string;
    creatorWallet: string;
    members: Member[];
    followers: number;
    createdAt: number;
  };
  performance: {
    initialNavUsdc: string;
    finalNavUsdc: string;
    totalReturn: number;
    maxDrawdown: number;
    settledMarkets: number;
    idleAgents: string[];
    points: Point[];
  };
}

const DEFAULT_CAP_USDC = 2;

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export default function BasketDetailClient({ basketId }: { basketId: string }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [data, setData] = useState<BasketDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cap, setCap] = useState(DEFAULT_CAP_USDC);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/baskets/${basketId}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return (await r.json()) as BasketDetail;
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => setNotFound(true));
  }, [basketId]);

  useEffect(load, [load]);

  async function submitCap(nextCap: number) {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      const signature = await signMessageAsync({
        message: followMessage({ basketId, follower: address, perMarketCapUsdc: nextCap }),
      });
      const res = await fetch(`/api/baskets/${basketId}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower: address, perMarketCapUsdc: nextCap, signature }),
      });
      const payload = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(payload.message ?? `HTTP ${res.status}`));
      setFollowing(Boolean(payload.following));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "the subscription could not be saved");
    } finally {
      setBusy(false);
    }
  }

  const sparkline = useMemo(() => {
    const points = data?.performance.points ?? [];
    if (points.length < 2) return null;
    const values = points.map((p) => Number(p.navUsdc));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const path = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = 30 - ((v - min) / span) * 28 - 1;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { path, up: values[values.length - 1] >= values[0] };
  }, [data]);

  if (notFound) {
    return (
      <div className="pb-16">
        <BlueprintHeading>Basket not found</BlueprintHeading>
        <div className="mx-auto max-w-[720px] px-4 pt-10 text-center sm:px-6">
          <Link href="/baskets" className="font-mono text-[12px] text-pv-emerald hover:underline">
            ← back to the directory
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-[900px] px-4 pt-16 sm:px-6">
        <div className="h-[420px] animate-pulse rounded-2xl border border-pv-border/25 bg-pv-surface2/30" />
      </div>
    );
  }

  const { basket, performance } = data;

  return (
    <div className="pb-16">
      <BlueprintHeading>{basket.name}</BlueprintHeading>

      <div className="mx-auto max-w-[900px] px-4 pt-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-2xl text-center text-sm text-pv-text/80">{basket.thesis}</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
          <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            {basket.id}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            <Users className="h-2.5 w-2.5" /> {basket.followers} following
          </span>
          <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            by {shortenAddress(basket.creatorWallet)}
          </span>
        </div>

        {/* Curve */}
        <section className="card mt-10 rounded-2xl p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="label mb-0">Replayed curve</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-pv-muted">
              {performance.settledMarkets} settled markets
            </span>
          </div>

          {sparkline ? (
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Basket value over time">
              <path
                d={sparkline.path}
                fill="none"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
                className={sparkline.up ? "stroke-pv-emerald" : "stroke-pv-danger"}
              />
            </svg>
          ) : (
            <p className="rounded-xl border border-dashed border-pv-border/40 px-4 py-8 text-center text-[12px] text-pv-muted">
              Not enough settled markets to draw a curve yet.
            </p>
          )}

          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-pv-border/30 pt-4 sm:grid-cols-4">
            {[
              ["Start", `${performance.initialNavUsdc} USDC`],
              ["Now", `${performance.finalNavUsdc} USDC`],
              ["Return", pct(performance.totalReturn)],
              ["Max drawdown", pct(performance.maxDrawdown)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/60">
                  {label}
                </dt>
                <dd className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 flex items-start gap-2 border-t border-pv-border/30 pt-3 text-[11px] leading-relaxed text-pv-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A hypothetical {performance.initialNavUsdc} USDC allocated by these weights and
            replayed through what the member agents actually settled on chain. Returns are
            stake-weighted per day and an idle leg earns zero. Nothing was deposited and
            nothing was pooled.
          </p>
        </section>

        {/* Legs */}
        <section className="card mt-6 rounded-2xl p-5">
          <h2 className="label">Legs</h2>
          <ul className="space-y-2">
            {basket.members.map((m) => (
              <li
                key={m.agentId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-pv-border/35 bg-pv-surface2/30 px-3.5 py-3"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-pv-text">
                  {m.agentId}
                </span>
                {m.idle && (
                  <span className="rounded-md border border-pv-border/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                    idle
                  </span>
                )}
                {m.wallet && (
                  <span className="font-mono text-[10px] text-pv-muted">
                    {shortenAddress(m.wallet)}
                  </span>
                )}
                <span className="font-display text-sm font-bold tabular-nums text-pv-text">
                  {(m.weightBps / 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Follow */}
        <section className="card mt-6 rounded-2xl p-5">
          <h2 className="label">Mirror this basket</h2>
          <p className="mb-4 text-[12px] leading-relaxed text-pv-muted">
            You sign a message naming this basket and a per-market ceiling. When its agents
            take new positions, the copy is staked from your own wallet with your own
            signature. Setting the cap to zero unfollows. Nothing is ever deposited here.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="cap" className="label">Per-market cap (USDC)</label>
              <input
                id="cap"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
                className="w-32 rounded-lg border border-pv-border/40 bg-pv-bg/80 px-3 py-2 text-right font-mono text-sm tabular-nums text-pv-text outline-none"
              />
            </div>
            <p className="mb-2 font-mono text-[11px] text-pv-muted">
              worst case {(cap * basket.members.length).toFixed(2)} USDC across{" "}
              {basket.members.length} legs
            </p>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-pv-danger/30 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="btn-primary flex items-center justify-center gap-2"
              disabled={!isConnected || busy || cap <= 0}
              onClick={() => void submitCap(cap)}
            >
              {busy ? "Waiting for signature…" : following ? "Update cap" : "Follow"}
              {!busy && <Check className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!isConnected || busy}
              onClick={() => void submitCap(0)}
            >
              Unfollow (cap to zero)
            </button>
          </div>
          {!isConnected && (
            <p className="mt-3 text-center text-[12px] text-pv-muted">
              Connect a wallet to mirror this basket.
            </p>
          )}
        </section>

        <nav className="mt-10 text-center">
          <Link href="/baskets" className="font-mono text-[12px] text-pv-muted hover:text-pv-text">
            ← all baskets
          </Link>
        </nav>
      </div>
    </div>
  );
}
