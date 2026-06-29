/**
 * x402 revenue ledger — tracks nanopayments the Mimir endpoints earn.
 *
 * Durable: writes each settled payment to Neon (x402_payments) so the dashboard
 * survives restarts. The on-chain Gateway balance is still the ultimate source
 * of truth. When DATABASE_URL is unset (local dev), it transparently falls back
 * to an in-memory ring buffer (last 1000 events) — never breaks serving.
 */

import {
  insertX402Payment,
  getX402RevenueSummary,
  type X402RevenueSummary,
} from "./db";

export interface PaymentEvent {
  resource: string; // which endpoint earned it (e.g. /api/premium/price)
  priceUsd: number; // dollars, e.g. 0.001
  payer: string | null; // buyer address, when the settlement header carries it
  seller: string | null; // wallet that received the payment
  txId: string | null; // Circle settlement id / tx
  at: number; // ms epoch
}

const MAX = 1000;
const events: PaymentEvent[] = [];

/** Record a settled payment. Never throws — accounting must not break serving. */
export function recordPayment(e: PaymentEvent): void {
  // In-memory mirror (instant, and the only store when no DB is configured).
  try {
    events.push(e);
    if (events.length > MAX) events.splice(0, events.length - MAX);
  } catch {
    /* ignore */
  }
  // Durable write — fire-and-forget, swallow errors (e.g. DB not configured).
  void insertX402Payment({
    resource: e.resource,
    price_usd: e.priceUsd,
    payer: e.payer,
    seller: e.seller,
    tx_id: e.txId,
    at: e.at,
  }).catch(() => {});
}

export interface RevenueSummary {
  totalCalls: number;
  totalUsd: number;
  uniquePayers: number;
  uniqueSellers: number;
  byResource: Array<{ resource: string; calls: number; usd: number }>;
  bySeller: Array<{ seller: string; calls: number; usd: number }>;
  recent: PaymentEvent[];
}

function fromDbSummary(s: X402RevenueSummary): RevenueSummary {
  return {
    totalCalls: s.totalCalls,
    totalUsd: s.totalUsd,
    uniquePayers: s.uniquePayers,
    uniqueSellers: s.uniqueSellers,
    byResource: s.byResource,
    bySeller: s.bySeller,
    recent: s.recent.map((r) => ({
      resource: r.resource,
      priceUsd: r.price_usd,
      payer: r.payer,
      seller: r.seller,
      txId: r.tx_id,
      at: r.at,
    })),
  };
}

function inMemorySummary(limit: number): RevenueSummary {
  const byResource = new Map<string, { calls: number; usd: number }>();
  const bySeller = new Map<string, { calls: number; usd: number }>();
  const payers = new Set<string>();
  const sellers = new Set<string>();
  let totalUsd = 0;
  for (const e of events) {
    totalUsd += e.priceUsd;
    if (e.payer) payers.add(e.payer.toLowerCase());
    if (e.seller) {
      const seller = e.seller.toLowerCase();
      sellers.add(seller);
      const s = bySeller.get(seller) ?? { calls: 0, usd: 0 };
      s.calls += 1;
      s.usd += e.priceUsd;
      bySeller.set(seller, s);
    }
    const r = byResource.get(e.resource) ?? { calls: 0, usd: 0 };
    r.calls += 1;
    r.usd += e.priceUsd;
    byResource.set(e.resource, r);
  }
  return {
    totalCalls: events.length,
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    uniquePayers: payers.size,
    uniqueSellers: sellers.size,
    byResource: [...byResource.entries()]
      .map(([resource, v]) => ({ resource, calls: v.calls, usd: Math.round(v.usd * 1e6) / 1e6 }))
      .sort((a, b) => b.usd - a.usd),
    bySeller: [...bySeller.entries()]
      .map(([seller, v]) => ({ seller, calls: v.calls, usd: Math.round(v.usd * 1e6) / 1e6 }))
      .sort((a, b) => b.usd - a.usd),
    recent: events.slice(-limit).reverse(),
  };
}

/** Durable summary from Neon; falls back to the in-memory buffer on any error. */
export async function getRevenueSummary(limit = 25): Promise<RevenueSummary> {
  try {
    return fromDbSummary(await getX402RevenueSummary(limit));
  } catch {
    return inMemorySummary(limit);
  }
}

/** Parse an x402 price string like "$0.001" or "0.001" into dollars. */
export function parsePriceUsd(price: string): number {
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
