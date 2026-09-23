import "server-only";

/**
 * Signature verification for agent requests.
 *
 * Plain EOAs sign EIP-191 personal messages; smart-contract wallets answer
 * through EIP-1271. The public client's verifyMessage covers both, falling back
 * to an on-chain isValidSignature call when offline recovery does not match.
 */
import { isAddress } from "viem";

import { createChainPublicClient } from "@/lib/arc";
import { enabledChainKeys } from "@/lib/chains";

/**
 * An EOA signature recovers offline and verifies on the first try. A smart
 * wallet only answers EIP-1271 on the chain it is deployed on (a Coinbase Smart
 * Wallet usually lives on Base), so each deployed chain is asked in turn.
 */
export async function verifyAgentSignature(args: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const { address, message, signature } = args;
  if (!isAddress(address) || !signature.startsWith("0x")) return false;
  const chains = enabledChainKeys();
  for (const chain of chains.length > 0 ? chains : (["arc"] as const)) {
    try {
      const ok = await createChainPublicClient(chain).verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (ok) return true;
    } catch {
      // This chain's RPC failed or has no code there; try the next one.
    }
  }
  return false;
}

export function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && isAddress(value) ? value.toLowerCase() : null;
}
