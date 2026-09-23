/**
 * Which chain the market creator opens the next market on.
 *
 * Round-robin over the chains it can use, so fresh inventory lands on every
 * network. MARKET_CREATOR_CHAINS (comma-separated chain keys) narrows and
 * orders that list. A rotation, not a single pick: when the chosen chain
 * can't take the market (low balance, failed tx) the creator falls through to
 * the next one instead of skipping the market.
 */
import { isChainKey, type ChainKey } from "../../lib/chains";

/**
 * Chains to open markets on, in preference order. Unknown keys, duplicates and
 * chains the creator has no wallet on drop out; when nothing usable is left
 * (or the env is unset) every usable chain is used, in registry order.
 */
export function creatorChainOrder(raw: string | undefined, usable: readonly ChainKey[]): ChainKey[] {
  const wanted = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isChainKey);
  const picked = [...new Set(wanted)].filter((c) => usable.includes(c));
  return picked.length > 0 ? picked : [...usable];
}

/** `order` rotated to start at `turn` (mod length): try-first, then the fallbacks. */
export function rotationFrom(order: readonly ChainKey[], turn: number): ChainKey[] {
  if (order.length === 0) return [];
  const start = ((Math.trunc(turn) % order.length) + order.length) % order.length;
  return [...order.slice(start), ...order.slice(0, start)];
}
