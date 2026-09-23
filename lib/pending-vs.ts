import { vsChain, type VSData } from "./contract";
import { claimKey, type ChainKey } from "./chains";

// Ids restart on every chain, so pending items are matched by chain + id.
const keyOf = (v: Pick<VSData, "id" | "chain">) => claimKey(vsChain(v), v.id);

const STORAGE_KEY = "proven_pending_vs";

export interface PendingVS extends VSData {
  /** Flag that marks this item as locally-optimistic (not yet on-chain). */
  pending: true;
  /** Epoch ms when the item was stored — used for automatic expiry. */
  createdAtMs: number;
  /** Optional tx hash for explorer link. */
  txHash?: string;
}

/** Max age before a pending item is silently discarded (5 minutes). */
const MAX_AGE_MS = 5 * 60 * 1000;

function readAll(): PendingVS[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const items: PendingVS[] = JSON.parse(raw);
    const now = Date.now();
    return items.filter((i) => now - i.createdAtMs < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeAll(items: PendingVS[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded — ignore
  }
}

/** Save a newly created VS so it shows up immediately in lists. */
export function savePendingVS(vs: PendingVS) {
  const items = readAll().filter((i) => keyOf(i) !== keyOf(vs));
  items.unshift(vs);
  writeAll(items);
}

/** Look up a single pending VS by chain + id. */
export function getPendingVS(id: number, chain: ChainKey = "arc"): PendingVS | null {
  const key = claimKey(chain, id);
  return readAll().find((i) => keyOf(i) === key) ?? null;
}

/** Remove a pending VS once it appears on-chain. */
export function removePendingVS(id: number, chain: ChainKey = "arc") {
  const key = claimKey(chain, id);
  writeAll(readAll().filter((i) => keyOf(i) !== key));
}

/**
 * Merge pending VS into a list fetched from the contract.
 * Items that already exist on-chain are removed from localStorage.
 * Remaining pending items are prepended to the list.
 */
export function mergePendingVS(
  onChain: VSData[],
  filterAddress?: string
): VSData[] {
  const pending = readAll();
  if (pending.length === 0) return onChain;

  const onChainIds = new Set(onChain.map(keyOf));
  const stillPending: PendingVS[] = [];

  for (const p of pending) {
    if (onChainIds.has(keyOf(p))) {
      // appeared on-chain — drop from localStorage
      removePendingVS(p.id, vsChain(p));
    } else if (
      !filterAddress ||
      p.creator.toLowerCase() === filterAddress.toLowerCase()
    ) {
      stillPending.push(p);
    }
  }

  return [...stillPending, ...onChain];
}
