/**
 * x402 revenue ledger — tracks nanopayments the Mimir endpoints earn.
 *
 * ponytail: in-memory ring buffer (last 1000 events). The on-chain Gateway
 * balance is the durable source of truth; this is for the live dashboard.
 * Swap for a Neon table if cross-restart persistence is needed.
 */

export interface PaymentEvent {
  resource: string; // which endpoint earned it (e.g. /api/premium/price)
  priceUsd: number; // dollars, e.g. 0.001
  payer: string | null; // buyer address, when the settlement header carries it
  txId: string | null; // Circle settlement id / tx
  at: number; // ms epoch
}

const MAX = 1000;
const events: PaymentEvent[] = [];

/** Record a settled payment. Never throws — accounting must not break serving. */
export function recordPayment(e: PaymentEvent): void {
  try {
    events.push(e);
    if (events.length > MAX) events.splice(0, events.length - MAX);
  } catch {
    /* ignore */
  }
}

export interface RevenueSummary {
  totalCalls: number;
  totalUsd: number;
  uniquePayers: number;
  byResource: Array<{ resource: string; calls: number; usd: number }>;
  recent: PaymentEvent[];
}

export function getRevenueSummary(limit = 25): RevenueSummary {
  const byResource = new Map<string, { calls: number; usd: number }>();
  const payers = new Set<string>();
  let totalUsd = 0;
  for (const e of events) {
    totalUsd += e.priceUsd;
    if (e.payer) payers.add(e.payer.toLowerCase());
    const r = byResource.get(e.resource) ?? { calls: 0, usd: 0 };
    r.calls += 1;
    r.usd += e.priceUsd;
    byResource.set(e.resource, r);
  }
  return {
    totalCalls: events.length,
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    uniquePayers: payers.size,
    byResource: [...byResource.entries()]
      .map(([resource, v]) => ({ resource, calls: v.calls, usd: Math.round(v.usd * 1e6) / 1e6 }))
      .sort((a, b) => b.usd - a.usd),
    recent: events.slice(-limit).reverse(),
  };
}

/** Parse an x402 price string like "$0.001" or "0.001" into dollars. */
export function parsePriceUsd(price: string): number {
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
