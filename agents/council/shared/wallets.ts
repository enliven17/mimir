/**
 * Persona wallets per chain.
 *
 * Kept out of personas.ts on purpose: the roster is imported by client pages,
 * and this module pulls in the W3S escrow code. Wallet ids follow the escrow
 * convention (CIRCLE_COUNCIL_<SLUG>_WALLET_ID on Arc, + _BASE / _ARBITRUM);
 * the address is shared across chains.
 */
import type { ChainKey } from "../../../lib/chains";
import { walletIdFor } from "../../../lib/w3s-escrow";
import { type PersonaSpec, personaAddressEnv, personaWalletIdEnv } from "../personas";

export function personaWalletIdOn(persona: PersonaSpec, chain: ChainKey): string | undefined {
  return walletIdFor(personaWalletIdEnv(persona), chain);
}

export function personaAddressOf(persona: PersonaSpec): `0x${string}` | undefined {
  const raw = process.env[personaAddressEnv(persona)]?.trim();
  return raw?.startsWith("0x") ? (raw as `0x${string}`) : undefined;
}
