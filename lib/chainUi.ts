/**
 * Client-side presentation of networks: dot colors and "is there more than one
 * network" checks. Literal class names so Tailwind's scanner keeps them.
 */
import { enabledChainKeys, type ChainKey } from "./chains";

export const CHAIN_DOT_CLASS: Record<ChainKey, string> = {
  arc: "bg-chain-arc",
  base: "bg-chain-base",
  arbitrum: "bg-chain-arbitrum",
};

/** Network UI (badges, selector, filter) only earns its space with 2+ chains live. */
export function isMultichain(): boolean {
  return enabledChainKeys().length > 1;
}
