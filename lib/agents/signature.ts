import "server-only";

/**
 * Signature verification for agent requests.
 *
 * Plain EOAs sign EIP-191 personal messages; smart-contract wallets answer
 * through EIP-1271. The public client's verifyMessage covers both, falling back
 * to an on-chain isValidSignature call when offline recovery does not match.
 */
import { isAddress, type PublicClient } from "viem";

import { createArcPublicClient } from "@/lib/arc";

let cached: PublicClient | null = null;

function client(): PublicClient {
  if (!cached) cached = createArcPublicClient();
  return cached;
}

export async function verifyAgentSignature(args: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const { address, message, signature } = args;
  if (!isAddress(address) || !signature.startsWith("0x")) return false;
  try {
    return await client().verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

export function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && isAddress(value) ? value.toLowerCase() : null;
}
