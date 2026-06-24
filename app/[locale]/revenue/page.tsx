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

// Arc testnet explorer. A settlement tx id that's a 0x hash links to the
// on-chain receipt; non-hash ids (Circle settlement ids) render as plain text.
const ARCSCAN = "https://testnet.arcscan.app";
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
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">x402 Revenue</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Live USDC nanopayments flowing into Mimir&apos;s paid endpoints. Refreshes every 5s.
      </p>

      {err && <p className="mt-6 text-sm text-red-400">Couldn&apos;t load: {err}</p>}

      {!data && !err && <p className="mt-6 text-sm text-neutral-500">Loading…</p>}

      {data && (
        <>
          <section className="mt-8 grid grid-cols-3 gap-4">
            <Stat label="Paid calls" value={data.totalCalls.toLocaleString()} />
            <Stat label="Total earned" value={`$${data.totalUsd.toFixed(6)}`} />
            <Stat label="Paying agents" value={data.uniquePayers.toLocaleString()} />
          </section>

          <section className="mt-10">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
              By endpoint
            </h2>
            <div className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800">
              {data.byResource.length === 0 && (
                <p className="px-4 py-6 text-sm text-neutral-500">
                  No payments yet — run <code className="text-neutral-300">npm run x402:demo</code>.
                </p>
              )}
              {data.byResource.map((r) => (
                <div key={r.resource} className="flex items-center justify-between px-4 py-3">
                  <code className="text-sm text-neutral-200">{r.resource}</code>
                  <div className="text-right text-sm">
                    <span className="text-neutral-100">${r.usd.toFixed(6)}</span>
                    <span className="ml-3 text-neutral-500">{r.calls} calls</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
              Recent payments
            </h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-900/50 text-left text-neutral-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Endpoint</th>
                    <th className="px-4 py-2 font-medium">Payer</th>
                    <th className="px-4 py-2 text-right font-medium">USDC</th>
                    <th className="px-4 py-2 text-right font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {data.recent.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                        Waiting for the first payment…
                      </td>
                    </tr>
                  )}
                  {data.recent.map((e, i) => (
                    <tr key={`${e.txId ?? i}-${e.at}`}>
                      <td className="px-4 py-2 text-neutral-400">
                        {new Date(e.at).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <code className="text-neutral-300">{e.resource}</code>
                      </td>
                      <td className="px-4 py-2 font-mono text-neutral-400">{short(e.payer)}</td>
                      <td className="px-4 py-2 text-right text-neutral-100">
                        ${e.priceUsd.toFixed(6)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {isTxHash(e.txId) ? (
                          <a
                            href={`${ARCSCAN}/tx/${e.txId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 hover:underline"
                          >
                            {short(e.txId)} ↗
                          </a>
                        ) : (
                          <span className="text-neutral-600">{short(e.txId)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 px-4 py-5">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-50">{value}</div>
    </div>
  );
}
