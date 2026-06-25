"use client";

/**
 * /revenue — live x402 nanopayment earnings dashboard.
 *
 * Shows USDC flowing into Mimir's paid endpoints in real time: total calls,
 * total earned, unique paying agents, per-endpoint breakdown, recent payments.
 *
 * Reads the durable Neon ledger via /api/x402/revenue (falls back to in-memory
 * when no DB is configured). Each settled payment links to its on-chain receipt
 * on ArcScan; the on-chain Gateway balance remains the ultimate truth.
 */

import { useEffect, useState } from "react";
import { BlueprintHeading } from "@/components/BlueprintGrid";

interface PaymentEvent {
  resource: string;
  priceUsd: number;
  payer: string | null;
  txId: string | null;
  at: number;
}
interface RevenueSummary {
  totalCalls: number;
  totalUsd: number;
  uniquePayers: number;
  byResource: Array<{ resource: string; calls: number; usd: number }>;
  recent: PaymentEvent[];
}

function short(addr: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const ARCSCAN = "https://testnet.arcscan.app";
// Circle's Gateway Wallet on Arc — where batched x402 nanopayments settle on-chain.
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
function isTxHash(id: string | null): id is string {
  return !!id && /^0x[0-9a-fA-F]{64}$/.test(id);
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/x402/revenue", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RevenueSummary;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "failed");
      }
    };
    load();
    const t = setInterval(load, 5000); // live refresh
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="pb-10">
      <BlueprintHeading>x402 Revenue</BlueprintHeading>
      <div className="mx-auto max-w-4xl px-4 pt-3 sm:px-6 lg:px-8">
      <p className="text-center font-mono text-[13px] text-pv-muted">
        Live USDC nanopayments flowing into Mimir&apos;s paid endpoints. Refreshes every 5s.
      </p>

      {err && <p className="mt-6 font-mono text-sm text-pv-danger">Couldn&apos;t load: {err}</p>}

      {!data && !err && <RevenueSkeleton />}

      {data && (
        <>
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Paid calls" value={data.totalCalls.toLocaleString()} />
            <Stat label="Total earned" value={`$${data.totalUsd.toFixed(6)}`} accent />
            <Stat label="Paying agents" value={data.uniquePayers.toLocaleString()} />
          </section>

          <section className="mt-10">
            <h2 className="label">By endpoint</h2>
            <div className="card mt-3 divide-y divide-white/[0.08]">
              {data.byResource.length === 0 && (
                <p className="px-4 py-6 font-mono text-sm text-pv-muted">
                  No payments yet — run <code className="text-pv-text">npm run x402:demo</code>.
                </p>
              )}
              {data.byResource.map((r) => (
                <div key={r.resource} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <code className="min-w-0 break-all font-mono text-sm text-pv-text">{r.resource}</code>
                  <div className="shrink-0 text-left text-sm sm:text-right">
                    <span className="font-mono font-semibold text-pv-text">${r.usd.toFixed(6)}</span>
                    <span className="ml-3 font-mono text-pv-muted">{r.calls} calls</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="label">Recent payments</h2>
            <div className="card mt-3 divide-y divide-white/[0.06] sm:hidden">
              {data.recent.length === 0 && (
                <p className="px-4 py-8 text-center font-mono text-sm text-pv-muted">
                  Waiting for the first payment...
                </p>
              )}
              {data.recent.map((e, i) => (
                <PaymentCard key={`${e.txId ?? i}-${e.at}`} event={e} />
              ))}
            </div>
            <div className="card mt-3 hidden sm:block">
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-white/[0.08] text-left">
                  <tr className="font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted">
                    <th className="w-[18%] px-4 py-2.5 font-bold">When</th>
                    <th className="w-[30%] px-4 py-2.5 font-bold">Endpoint</th>
                    <th className="w-[18%] px-4 py-2.5 font-bold">Payer</th>
                    <th className="w-[16%] px-4 py-2.5 text-right font-bold">USDC</th>
                    <th className="w-[18%] px-4 py-2.5 text-right font-bold">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.recent.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center font-mono text-pv-muted">
                        Waiting for the first payment…
                      </td>
                    </tr>
                  )}
                  {data.recent.map((e, i) => (
                    <tr key={`${e.txId ?? i}-${e.at}`} className="transition-colors hover:bg-pv-surface2/40">
                      <td className="px-4 py-2.5 font-mono text-pv-muted">
                        {new Date(e.at).toLocaleTimeString()}
                      </td>
                      <td className="min-w-0 px-4 py-2.5">
                        <code className="block truncate font-mono text-pv-text" title={e.resource}>{e.resource}</code>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-pv-muted">{short(e.payer)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-pv-text">
                        ${e.priceUsd.toFixed(6)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {isTxHash(e.txId) ? (
                          <a
                            href={`${ARCSCAN}/tx/${e.txId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pv-emerald underline-offset-2 hover:underline"
                            title={e.txId}
                          >
                            {short(e.txId)} ↗
                          </a>
                        ) : e.payer ? (
                          <a
                            href={`${ARCSCAN}/address/${e.payer}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pv-emerald underline-offset-2 hover:underline"
                            title={`Payer on Arc — settlement ${e.txId ?? ""}`}
                          >
                            payer ↗
                          </a>
                        ) : (
                          <span className="text-pv-muted/60">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-pv-muted">
              Payments are W3S-signed and settled in USDC on Arc through Circle&apos;s Gateway —
              batched on-chain at the{" "}
              <a
                href={`${ARCSCAN}/address/${GATEWAY_WALLET}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-pv-emerald underline-offset-2 hover:underline"
              >
                Gateway Wallet contract ↗
              </a>
              . Each receipt links to the paying agent&apos;s on-chain account.
            </p>
          </section>
        </>
      )}
      </div>
    </div>
  );
}

function PaymentCard({ event }: { event: PaymentEvent }) {
  const receipt = isTxHash(event.txId) ? (
    <a
      href={`${ARCSCAN}/tx/${event.txId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-pv-emerald underline-offset-2 hover:underline"
      title={event.txId}
    >
      {short(event.txId)} ↗
    </a>
  ) : event.payer ? (
    <a
      href={`${ARCSCAN}/address/${event.payer}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-pv-emerald underline-offset-2 hover:underline"
      title={`Payer on Arc — settlement ${event.txId ?? ""}`}
    >
      payer ↗
    </a>
  ) : (
    <span className="text-pv-muted/60">—</span>
  );

  return (
    <div className="px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted">
            {new Date(event.at).toLocaleTimeString()}
          </p>
          <code className="mt-1 block break-all font-mono text-sm text-pv-text">
            {event.resource}
          </code>
        </div>
        <span className="shrink-0 font-mono text-sm font-semibold text-pv-text">
          ${event.priceUsd.toFixed(6)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-xs">
        <span className="min-w-0 truncate text-pv-muted">{short(event.payer)}</span>
        <span className="shrink-0">{receipt}</span>
      </div>
    </div>
  );
}

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer bg-pv-surface2 ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

function RevenueSkeleton() {
  return (
    <div aria-busy className="mt-8" aria-label="Loading revenue">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card px-4 py-5">
            <Bar className="h-3 w-24" />
            <Bar className="mt-3 h-7 w-28" />
          </div>
        ))}
      </section>
      <section className="mt-10">
        <Bar className="h-3 w-24" />
        <div className="card mt-3 divide-y divide-white/[0.08]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Bar className="h-4 w-40" />
              <Bar className="h-4 w-24" />
            </div>
          ))}
        </div>
      </section>
      <section className="mt-10">
        <Bar className="h-3 w-32" />
        <div className="card mt-3 divide-y divide-white/[0.06]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <Bar className="h-4 w-20" />
              <Bar className="h-4 w-32" />
              <Bar className="h-4 w-20" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card px-4 py-5">
      <div className="label mb-0">{label}</div>
      <div
        className={`mt-2 font-display text-2xl font-bold tracking-tight ${
          accent ? "text-pv-emerald" : "text-pv-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
