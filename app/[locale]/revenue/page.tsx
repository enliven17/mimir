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
import { shortenAddress } from "@/lib/constants";
import { GATEWAY_WALLET_ADDRESS } from "@/lib/arc";

interface PaymentEvent {
  resource: string;
  priceUsd: number;
  payer: string | null;
  seller: string | null;
  txId: string | null;
  at: number;
}
interface RevenueSummary {
  totalCalls: number;
  baselineCalls: number;
  totalUsd: number;
  baselineUsd: number;
  uniquePayers: number;
  uniqueSellers: number;
  byResource: Array<{ resource: string; calls: number; usd: number }>;
  bySeller: Array<{ seller: string; calls: number; usd: number }>;
  recent: PaymentEvent[];
}

function short(addr: string | null): string {
  return addr ? shortenAddress(addr) : "—";
}

const ARCSCAN = "https://testnet.arcscan.app";
const GATEWAY_WALLET = GATEWAY_WALLET_ADDRESS;
function isTxHash(id: string | null): id is string {
  return !!id && /^0x[0-9a-fA-F]{64}$/.test(id);
}

interface SettlementTx {
  hash: string;
  method: string | null;
  status: string;
  timestamp: string;
  from: string;
  valueUsdc: number;
}

/**
 * Per-payment receipt. Nanopayments settle through Circle's Gateway in
 * BATCHES, so most payments have a facilitator settlement id instead of an
 * on-chain tx hash — label those honestly rather than dressing them up.
 */
function ReceiptLink({ txId, payer }: { txId: string | null; payer: string | null }) {
  if (isTxHash(txId)) {
    return (
      <a
        href={`${ARCSCAN}/tx/${txId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-pv-emerald underline-offset-2 hover:underline"
        title={txId}
      >
        {short(txId)} ↗
      </a>
    );
  }
  if (txId || payer) {
    return (
      <a
        href={`${ARCSCAN}/address/${GATEWAY_WALLET}`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-white/[0.12] bg-pv-surface2/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted transition-colors hover:border-pv-emerald/40 hover:text-pv-emerald"
        title={`Verified off-chain by Circle's facilitator; settles on-chain in a Gateway batch.${txId ? ` Settlement id: ${txId}` : ""}`}
      >
        batched ↗
      </a>
    );
  }
  return <span className="text-pv-muted/60">—</span>;
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenueSummary | null>(null);
  const [settlements, setSettlements] = useState<SettlementTx[]>([]);
  const [settlementsError, setSettlementsError] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // No cache override: the route is edge-cached for 10s, and `no-store` here
        // forced every poll through to the function.
        const res = await fetch("/api/x402/revenue");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RevenueSummary;
        if (alive) setData(json);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "failed");
      }
    };
    // Gateway batches land on-chain slowly — server caches for 30s anyway.
    const loadSettlements = async () => {
      try {
        const res = await fetch("/api/x402/settlements");
        if (!res.ok) return;
        const json = (await res.json()) as { items?: SettlementTx[]; error?: boolean };
        if (!alive) return;
        if (Array.isArray(json.items)) setSettlements(json.items);
        setSettlementsError(Boolean(json.error));
      } catch {
        // explorer hiccup — keep the last list
      }
    };
    load();
    loadSettlements();
    const t = setInterval(load, 15000); // live refresh, aligned with the 10s edge cache
    const ts = setInterval(loadSettlements, 60000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(ts);
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
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Stat label="Paid calls" value={data.totalCalls.toLocaleString()} />
            <Stat label="Total earned" value={`$${data.totalUsd.toFixed(6)}`} accent />
            <Stat label="Paying agents" value={data.uniquePayers.toLocaleString()} />
            <Stat label="Seller wallets" value={data.uniqueSellers.toLocaleString()} />
          </section>

          {(data.baselineCalls > 0 || data.baselineUsd > 0) && (
            <p className="mt-3 font-mono text-xs text-pv-muted">
              Includes {data.baselineCalls.toLocaleString()} paid calls ($
              {data.baselineUsd.toFixed(2)}) carried over from the previous database.
            </p>
          )}

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
            <h2 className="label">By seller wallet</h2>
            <div className="card mt-3 divide-y divide-white/[0.08]">
              {data.bySeller.length === 0 && (
                <p className="px-4 py-6 font-mono text-sm text-pv-muted">
                  Seller wallet accounting appears after the next settled payment.
                </p>
              )}
              {data.bySeller.map((r) => (
                <div key={r.seller} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <a
                    href={`${ARCSCAN}/address/${r.seller}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 break-all font-mono text-sm text-pv-text underline-offset-2 hover:text-pv-emerald hover:underline"
                  >
                    {short(r.seller)}
                  </a>
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
                    <th className="w-[14%] px-4 py-2.5 font-bold">When</th>
                    <th className="w-[26%] px-4 py-2.5 font-bold">Endpoint</th>
                    <th className="w-[15%] px-4 py-2.5 font-bold">Payer</th>
                    <th className="w-[15%] px-4 py-2.5 font-bold">Seller</th>
                    <th className="w-[14%] px-4 py-2.5 text-right font-bold">USDC</th>
                    <th className="w-[16%] px-4 py-2.5 text-right font-bold">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.recent.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center font-mono text-pv-muted">
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
                      <td className="px-4 py-2.5 font-mono text-pv-muted">{short(e.seller)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-pv-text">
                        ${e.priceUsd.toFixed(6)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <ReceiptLink txId={e.txId} payer={e.payer} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-pv-muted">
              Payments are W3S-signed and settled in USDC on Arc through Circle&apos;s Gateway —
              individual nanopayments are verified off-chain by the facilitator and land
              on-chain in batches at the{" "}
              <a
                href={`${ARCSCAN}/address/${GATEWAY_WALLET}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-pv-emerald underline-offset-2 hover:underline"
              >
                Gateway Wallet contract ↗
              </a>
              . Seller wallets show which persona or platform wallet earned each read.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="label">On-chain batch settlements</h2>
            <div className="card mt-3">
              <table className="w-full table-fixed text-sm">
                <thead className="border-b border-white/[0.08] text-left">
                  <tr className="font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted">
                    <th className="w-[22%] px-4 py-2.5 font-bold">When</th>
                    <th className="w-[22%] px-4 py-2.5 font-bold">Method</th>
                    <th className="w-[22%] px-4 py-2.5 font-bold">From</th>
                    <th className="w-[16%] px-4 py-2.5 text-right font-bold">USDC</th>
                    <th className="w-[18%] px-4 py-2.5 text-right font-bold">Tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {settlements.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center font-mono text-pv-muted">
                        {settlementsError
                          ? "ArcScan's explorer API is temporarily unavailable — check back shortly."
                          : "No Gateway transactions loaded yet…"}
                      </td>
                    </tr>
                  )}
                  {settlements.map((s) => (
                    <tr key={s.hash} className="transition-colors hover:bg-pv-surface2/40">
                      <td className="px-4 py-2.5 font-mono text-pv-muted">
                        {s.timestamp ? new Date(s.timestamp).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="font-mono text-pv-text">{s.method ?? "transfer"}</code>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-pv-muted">{short(s.from)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-pv-text">
                        {s.valueUsdc > 0 ? s.valueUsdc.toFixed(4) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <a
                          href={`${ARCSCAN}/tx/${s.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pv-emerald underline-offset-2 hover:underline"
                          title={s.hash}
                        >
                          {short(s.hash)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-pv-muted">
              Real transactions on the Gateway Wallet contract, straight from ArcScan —
              the on-chain counterpart of the batched receipts above.
            </p>
          </section>
        </>
      )}
      </div>
    </div>
  );
}

function PaymentCard({ event }: { event: PaymentEvent }) {
  const receipt = <ReceiptLink txId={event.txId} payer={event.payer} />;

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
      <div className="mt-3 grid grid-cols-1 gap-1 font-mono text-xs text-pv-muted">
        <span className="min-w-0 truncate">payer {short(event.payer)}</span>
        <span className="min-w-0 truncate">seller {short(event.seller)}</span>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3 font-mono text-xs">
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
