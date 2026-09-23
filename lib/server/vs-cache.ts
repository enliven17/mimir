import { mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import {
  getClaimCount,
  getVS,
  getVSSummaries,
  vsChain,
  type VSData,
} from "@/lib/contract";
import { getContractAddress } from "@/lib/arc";
import { enabledChainKeys, type ChainKey } from "@/lib/chains";

// Fallback read path for when the Neon index is down: one snapshot per chain,
// each keyed to its own contract address so a redeploy invalidates only it.

const ACTIVE_STATES = new Set<VSData["state"]>(["open", "accepted"]);
const VS_PAGE_SIZE = 50;
const VS_FULL_REBUILD_MS = 5 * 60 * 1000;

export const VS_REVALIDATE_SECONDS = 15;
export const VS_CACHE_HEADERS = {
  "Cache-Control": `s-maxage=${VS_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
};

type VSSnapshot = {
  chain?: ChainKey;
  contractAddress: string;
  syncedAt: number;
  totalCount: number;
  items: VSData[];
};

type VSCacheState = {
  snapshots: Map<ChainKey, VSSnapshot>;
  syncPromises: Map<ChainKey, Promise<VSSnapshot>>;
};

declare global {
  var __provenVSCache: VSCacheState | undefined;
}

function getCacheState(): VSCacheState {
  if (!globalThis.__provenVSCache?.snapshots) {
    globalThis.__provenVSCache = { snapshots: new Map(), syncPromises: new Map() };
  }
  return globalThis.__provenVSCache;
}

function getSnapshotPath(chain: ChainKey) {
  const baseDir =
    process.env.PROVEN_CACHE_DIR ||
    (process.env.VERCEL ? path.join(tmpdir(), "proven-cache") : path.join(process.cwd(), ".cache"));

  return path.join(
    baseDir,
    `vs-index-${chain}-${String(getContractAddress(chain)).toLowerCase()}.json`
  );
}

function sortVS(items: VSData[]) {
  return [...items].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || b.id - a.id);
}

function upsertVS(items: VSData[], updates: VSData[]) {
  if (updates.length === 0) {
    return sortVS(items);
  }

  const byId = new Map<number, VSData>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  for (const update of updates) {
    byId.set(update.id, update);
  }

  return sortVS(Array.from(byId.values()));
}

function snapshotIsFresh(snapshot: VSSnapshot | null | undefined, chain: ChainKey) {
  if (!snapshot) {
    return false;
  }
  if (snapshot.contractAddress !== getContractAddress(chain)) {
    return false;
  }

  return Date.now() - snapshot.syncedAt <= VS_REVALIDATE_SECONDS * 1000;
}

function shouldRebuildFromScratch(snapshot: VSSnapshot | null, count: number, chain: ChainKey) {
  if (!snapshot) {
    return true;
  }
  if (snapshot.contractAddress !== getContractAddress(chain)) {
    return true;
  }
  if (count < snapshot.totalCount) {
    return true;
  }

  return Date.now() - snapshot.syncedAt > VS_FULL_REBUILD_MS;
}

function matchesUser(vs: VSData, address: string) {
  const normalized = address.toLowerCase();
  if (vs.creator.toLowerCase() === normalized) {
    return true;
  }
  if (vs.opponent.toLowerCase() === normalized) {
    return true;
  }

  return (vs.challenger_addresses ?? []).some(
    (challengerAddress) => challengerAddress.toLowerCase() === normalized
  );
}

async function readSnapshotFromDisk(chain: ChainKey): Promise<VSSnapshot | null> {
  try {
    const raw = await readFile(getSnapshotPath(chain), "utf8");
    return JSON.parse(raw) as VSSnapshot;
  } catch {
    return null;
  }
}

async function writeSnapshotToDisk(snapshot: VSSnapshot, chain: ChainKey) {
  const snapshotPath = getSnapshotPath(chain);

  try {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify(snapshot), "utf8");
  } catch (error) {
    // Vercel's project filesystem is read-only; keep serving from memory if disk persistence fails.
    console.warn("Unable to persist VS snapshot to disk.", error);
  }
}

async function fetchAllVSSummaries(count: number, chain: ChainKey) {
  if (count <= 0) {
    return [];
  }

  const pages = await Promise.all(
    Array.from({ length: Math.ceil(count / VS_PAGE_SIZE) }, (_, index) =>
      getVSSummaries(index * VS_PAGE_SIZE + 1, VS_PAGE_SIZE, chain)
    )
  );

  return sortVS(pages.flat());
}

function makeSnapshot(items: VSData[], totalCount: number, chain: ChainKey): VSSnapshot {
  return {
    chain,
    contractAddress: getContractAddress(chain),
    syncedAt: Date.now(),
    totalCount,
    items: sortVS(items),
  };
}

async function rebuildSnapshot(totalCount: number, chain: ChainKey) {
  const items = await fetchAllVSSummaries(totalCount, chain);
  const snapshot = makeSnapshot(items, totalCount, chain);
  await writeSnapshotToDisk(snapshot, chain);
  return snapshot;
}

async function refreshSnapshot(chain: ChainKey, force = false): Promise<VSSnapshot> {
  const state = getCacheState();
  const cached = state.snapshots.get(chain) ?? (await readSnapshotFromDisk(chain));

  if (!force && cached && snapshotIsFresh(cached, chain)) {
    state.snapshots.set(chain, cached);
    return cached;
  }

  const totalCount = await getClaimCount(chain);
  if (force || shouldRebuildFromScratch(cached ?? null, totalCount, chain)) {
    const rebuilt = await rebuildSnapshot(totalCount, chain);
    state.snapshots.set(chain, rebuilt);
    return rebuilt;
  }

  let items = cached?.items ?? [];

  if (totalCount > (cached?.totalCount ?? 0)) {
    for (
      let startId = (cached?.totalCount ?? 0) + 1;
      startId <= totalCount;
      startId += VS_PAGE_SIZE
    ) {
      const freshPage = await getVSSummaries(startId, VS_PAGE_SIZE, chain);
      items = upsertVS(items, freshPage);
    }
  }

  // Re-read only what can still change: open and accepted claims.
  const liveIds = items
    .filter((item) => ACTIVE_STATES.has(item.state))
    .map((item) => item.id);
  if (liveIds.length > 0) {
    const updates = await Promise.all(liveIds.map((id) => getVS(id, { chain })));
    items = upsertVS(items, updates.filter((item): item is VSData => item !== null));
  }

  const snapshot = makeSnapshot(items, totalCount, chain);
  await writeSnapshotToDisk(snapshot, chain);
  state.snapshots.set(chain, snapshot);
  return snapshot;
}

async function ensureSnapshot(chain: ChainKey, force = false) {
  const state = getCacheState();
  const cached = state.snapshots.get(chain) ?? (await readSnapshotFromDisk(chain));
  if (!force && cached && snapshotIsFresh(cached, chain)) {
    state.snapshots.set(chain, cached);
    return cached;
  }

  let pending = state.syncPromises.get(chain);
  if (!pending || force) {
    pending = refreshSnapshot(chain, force).finally(() => {
      getCacheState().syncPromises.delete(chain);
    });
    state.syncPromises.set(chain, pending);
  }
  return pending;
}

/** Items from every chain; a chain whose RPC is down contributes nothing. */
async function allItems(force = false): Promise<VSData[]> {
  const perChain = await Promise.all(
    enabledChainKeys().map((chain) =>
      ensureSnapshot(chain, force)
        .then((snap) => snap.items.map((vs) => ({ ...vs, chain: vs.chain ?? chain })))
        .catch(() => [] as VSData[]),
    ),
  );
  return sortVS(perChain.flat());
}

export async function refreshVSIndex() {
  return { items: await allItems(true) };
}

export async function getAllVSFast(): Promise<VSData[]> {
  return allItems();
}

export async function getVSByIdFast(vsId: number, chain: ChainKey = "arc"): Promise<VSData | null> {
  const snapshot = await ensureSnapshot(chain);
  const found = snapshot.items.find((vs) => vs.id === vsId && vsChain(vs) === chain);
  const live = await getVS(vsId, { chain });
  if (!live) {
    return found ?? null;
  }

  const updatedSnapshot = makeSnapshot(
    upsertVS(snapshot.items, [live]),
    Math.max(snapshot.totalCount, live.id),
    chain,
  );
  await writeSnapshotToDisk(updatedSnapshot, chain);
  getCacheState().snapshots.set(chain, updatedSnapshot);

  return live;
}

export async function getUserVSFast(address: string): Promise<VSData[]> {
  return (await allItems()).filter((vs) => matchesUser(vs, address));
}
