/**
 * Paid council-to-council reads.
 *
 * A persona can buy another persona's public reasoning before making its own
 * decision. This turns the council into a small information market instead of
 * ten isolated voters.
 */

import type { ChainKey } from "../../../lib/chains";
import { fetchWithBudget, usdcToAtomic, type PayingAgent } from "../../../lib/x402";
import { chainQuery, payingAgentFor as payerFromEnv } from "../../shared/chains";
import { type PersonaSpec, personaWalletIdEnv } from "../personas";
import { personaAddressOf } from "./wallets";

export interface PeerReasoningRead {
  sellerSlug: string;
  sellerName: string;
  reasoning: string;
  pricePaidAtomic: string | null;
}

interface ReasoningResponse {
  reasoning?: string;
  persona?: {
    slug?: string;
    name?: string;
  };
}

/** Pays on the claim's chain first, signing with that chain's persona wallet. */
function payingAgentFor(persona: PersonaSpec, chain: ChainKey): PayingAgent | null {
  const address = personaAddressOf(persona);
  return address ? payerFromEnv(personaWalletIdEnv(persona), address, chain) : null;
}

function selectPeerSellers(
  buyer: PersonaSpec,
  activePersonas: PersonaSpec[],
  claimId: number,
  count: number,
): PersonaSpec[] {
  const peers = activePersonas.filter((persona) => persona.slug !== buyer.slug);
  if (peers.length <= count) return peers;

  const buyerIndex = activePersonas.findIndex((persona) => persona.slug === buyer.slug);
  const offset = Math.max(0, buyerIndex) + claimId;
  const rotated = [...peers.slice(offset % peers.length), ...peers.slice(0, offset % peers.length)];
  return rotated.slice(0, count);
}

export async function buyPeerReasoning(args: {
  buyer: PersonaSpec;
  activePersonas: PersonaSpec[];
  /** Chain the claim lives on; ids restart per chain. */
  chain: ChainKey;
  claimId: number;
  baseUrl: string;
  readsPerPersona: number;
  capUsdc: number;
  delayMs: number;
}): Promise<PeerReasoningRead[]> {
  if (args.readsPerPersona <= 0) return [];

  const payer = payingAgentFor(args.buyer, args.chain);
  if (!payer) return [];

  const capAtomic = usdcToAtomic(args.capUsdc);
  const sellers = selectPeerSellers(
    args.buyer,
    args.activePersonas,
    args.claimId,
    args.readsPerPersona,
  );
  const reads: PeerReasoningRead[] = [];

  for (const seller of sellers) {
    const url =
      `${args.baseUrl.replace(/\/$/, "")}/api/council/reasoning` +
      `?claimId=${encodeURIComponent(String(args.claimId))}` +
      `&persona=${encodeURIComponent(seller.slug)}` +
      chainQuery(args.chain);

    try {
      const result = await fetchWithBudget(url, payer, capAtomic, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!result.response.ok) continue;

      const body = (await result.response.json()) as ReasoningResponse;
      const reasoning = String(body.reasoning ?? "").trim();
      if (!reasoning) continue;

      reads.push({
        sellerSlug: body.persona?.slug ?? seller.slug,
        sellerName: body.persona?.name ?? seller.displayName,
        reasoning: reasoning.slice(0, 360),
        pricePaidAtomic: result.payment?.priceAtomic?.toString() ?? null,
      });
    } catch (err) {
      console.warn(
        `[council:${args.buyer.slug}][${args.chain}] peer read failed from ${seller.slug}:`,
        err instanceof Error ? err.message : err,
      );
    }

    if (args.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    }
  }

  return reads;
}
