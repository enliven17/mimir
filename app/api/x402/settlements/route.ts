/**
 * Recent on-chain activity of Circle's Gateway Wallet — the contract where
 * batched x402 nanopayments actually settle — on every deployed chain.
 * Individual $0.001 payments are verified off-chain by the facilitator and
 * only hit the chain as batches, so this endpoint is the on-chain counterpart
 * to the per-payment receipts on /revenue.
 *
 * Proxies each chain's Blockscout API server-side (same origin for the client,
 * no CORS), trimmed to the fields the dashboard renders. The Gateway Wallet has
 * the same address on every testnet.
 */

import { GATEWAY_WALLET_ADDRESS } from "@/lib/arc";
import { enabledChainKeys, explorerTxUrl, stakeUnitsToUsdc, type ChainKey } from "@/lib/chains";

const BLOCKSCOUT_API: Record<ChainKey, string> = {
  arc: "https://testnet.arcscan.app/api/v2",
  base: "https://base-sepolia.blockscout.com/api/v2",
  arbitrum: "https://arbitrum-sepolia.blockscout.com/api/v2",
};
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

async function chainActivity(chain: ChainKey) {
  const res = await fetch(
    `${BLOCKSCOUT_API[chain]}/addresses/${GATEWAY_WALLET_ADDRESS}/transactions`,
    { next: { revalidate: 30 }, signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`${chain} explorer ${res.status}`);
  const body = (await res.json()) as { items?: BlockscoutTx[] };
  return (body.items ?? []).slice(0, MAX_ITEMS).map((t) => {
    const hash = String(t.hash ?? "");
    return {
      chain,
      hash,
      explorerUrl: hash ? explorerTxUrl(chain, hash) : null,
      method: t.method ?? null,
      status: String(t.status ?? ""),
      timestamp: String(t.timestamp ?? ""),
      from: String(t.from?.hash ?? ""),
      // Native value is USDC only on Arc; elsewhere it is ETH and the USDC moves
      // as an ERC-20 transfer inside the batch, so there is no value to show.
      valueUsdc: chain === "arc" ? stakeUnitsToUsdc("arc", BigInt(t.value ?? "0")) : null,
    };
  });
}

export async function GET(): Promise<Response> {
  const chains = enabledChainKeys();
  const results = await Promise.allSettled(chains.map(chainActivity));
  const items = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => Date.parse(b.timestamp || "0") - Date.parse(a.timestamp || "0"))
    .slice(0, MAX_ITEMS);
  // Distinguish "explorers are down" from "no settlements yet" so the dashboard
  // doesn't tell users there's no data when it's actually an explorer 503ing.
  const failed = chains.filter((_, i) => results[i].status === "rejected");
  return Response.json(
    {
      gateway: GATEWAY_WALLET_ADDRESS,
      items,
      ...(failed.length === chains.length ? { error: true } : {}),
      ...(failed.length > 0 ? { unavailable: failed } : {}),
    },
    // Without a response header every client poll would wake the function to
    // serve the upstream body that is already revalidating every 30s.
    { headers: { "cache-control": "s-maxage=30, stale-while-revalidate=60" } },
  );
}
