/**
 * Pure helpers behind the header network selector (lib/wallet.tsx).
 *
 * Kept free of React and `window` so the node test suite can cover the
 * parsing rules: a stale or hand-edited localStorage value must never select a
 * chain the app has no escrow on.
 */
import { DEFAULT_CHAIN, isChainKey, type ChainKey } from "./chains";

export const SELECTED_CHAIN_STORAGE_KEY = "mimir:selected-chain";

/**
 * The chain to use given a stored value and the chains with a deployed escrow.
 * Unknown or disabled values fall back to the default chain, then to the first
 * enabled chain, then to Arc (the home chain always renders something).
 */
export function resolveSelectedChain(
  stored: unknown,
  enabled: readonly ChainKey[],
  fallback: ChainKey = DEFAULT_CHAIN,
): ChainKey {
  if (isChainKey(stored) && enabled.includes(stored)) return stored;
  if (enabled.includes(fallback)) return fallback;
  return enabled[0] ?? "arc";
}

/** localStorage read that tolerates private mode, quotas and SSR. */
export function readStoredChain(): string | null {
  try {
    return typeof window === "undefined"
      ? null
      : window.localStorage.getItem(SELECTED_CHAIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredChain(key: ChainKey): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SELECTED_CHAIN_STORAGE_KEY, key);
    }
  } catch {
    /* storage unavailable: the selection just won't survive a reload */
  }
}
