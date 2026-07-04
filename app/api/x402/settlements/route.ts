/**
 * Recent on-chain activity of Circle's Gateway Wallet on Arc — the contract
 * where batched x402 nanopayments actually settle. Individual $0.001 payments
 * are verified off-chain by the facilitator and only hit the chain as batches,
 * so this endpoint is the on-chain counterpart to the per-payment receipts on
 * /revenue.
 *
 * Proxies ArcScan's Blockscout API server-side (same origin for the client,
 * no CORS), trimmed to the fields the dashboard renders.
 */

import { GATEWAY_WALLET_ADDRESS, weiToUsdc } from "@/lib/arc";

const ARCSCAN_API = "https://testnet.arcscan.app/api/v2";
const MAX_ITEMS = 12;

interface BlockscoutTx {
  hash?: string;
  method?: string | null;
  status?: string;
  timestamp?: string;
  value?: string;
  from?: { hash?: string };
  to?: { hash?: string };
}

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(
      `${ARCSCAN_API}/addresses/${GATEWAY_WALLET_ADDRESS}/transactions`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) {
      return Response.json({ gateway: GATEWAY_WALLET_ADDRESS, items: [] });
    }
    const body = (await res.json()) as { items?: BlockscoutTx[] };
    const items = (body.items ?? []).slice(0, MAX_ITEMS).map((t) => ({
      hash: String(t.hash ?? ""),
      method: t.method ?? null,
      status: String(t.status ?? ""),
      timestamp: String(t.timestamp ?? ""),
      from: String(t.from?.hash ?? ""),
      valueUsdc: weiToUsdc(BigInt(t.value ?? "0")),
    }));
    return Response.json({ gateway: GATEWAY_WALLET_ADDRESS, items });
  } catch {
    // Explorer down → empty list; the dashboard renders its placeholder.
    return Response.json({ gateway: GATEWAY_WALLET_ADDRESS, items: [] });
  }
}
