import Link from "next/link";
import {
  createArcPublicClient,
  getContractAddress,
  getDeployBlock,
  paginatedGetLogs,
  weiToUsdc,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";
import {
  classifyActor,
  getActiveCouncilPersonas,
  getPersonaForAddress,
} from "@/lib/council-resolver";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { openPeepsAvatar } from "@/lib/avatars";
import { shortenAddress } from "@/lib/constants";
import { cachedFor } from "@/lib/server/ttl-cache";

// `searchParams` makes this route dynamic, so the `revalidate` export alone
// doesn't cache it (Next skips the Full Route Cache for dynamic renders) —
// the persona filter would otherwise re-scan the full chain history on every
// click. cachedFor covers the actual expensive work regardless.
export const revalidate = 20;

/* ── Data ────────────────────────────────────────────────────────────────── */

type EventRow =
  | {
      kind:        "created";
      claimId:     number;
      actor:       string;
      category:    string;
      txHash:      string;
      blockNumber: number;
    }
  | {
      kind:        "challenged";
      claimId:     number;
      actor:       string;
      stakeWei:    bigint;
      txHash:      string;
      blockNumber: number;
    }
  | {
      kind:        "resolved";
      claimId:     number;
      winnerSide:  number;
      confidence:  number;
      summary:     string;
      txHash:      string;
      blockNumber: number;
    };

const fetchEvents = cachedFor(fetchEventsUncached, 20_000);

async function fetchEventsUncached() {
  const client  = createArcPublicClient();
  const address = getContractAddress();
  const fromBlock = getDeployBlock();
  try {
    const [created, challenged, resolved] = await Promise.all([
      paginatedGetLogs(client, {
        address,
        event: {
          type: "event",
          name: "ClaimCreated",
          inputs: [
            { name: "id",       type: "uint256", indexed: true },
            { name: "creator",  type: "address", indexed: true },
            { name: "category", type: "string",  indexed: false },
          ],
        } as any,
      }, fromBlock),
      paginatedGetLogs(client, {
        address,
        event: {
          type: "event",
          name: "ClaimChallenged",
          inputs: [
            { name: "id",         type: "uint256", indexed: true },
            { name: "challenger", type: "address", indexed: true },
            { name: "stake",      type: "uint256", indexed: false },
          ],
        } as any,
      }, fromBlock),
      paginatedGetLogs(client, {
        address,
        event: {
          type: "event",
          name: "ClaimResolved",
          inputs: [
            { name: "id",           type: "uint256", indexed: true },
            { name: "winnerSide",   type: "uint8",   indexed: false },
            { name: "summary",      type: "string",  indexed: false },
            { name: "confidence",   type: "uint8",   indexed: false },
            { name: "evidenceHash", type: "bytes32", indexed: false },
          ],
        } as any,
      }, fromBlock),
    ]);

    const rows: EventRow[] = [
      ...created.map((log: any) => ({
        kind:        "created" as const,
        claimId:     Number(log.args.id ?? 0),
        actor:       String(log.args.creator ?? "").toLowerCase(),
        category:    String(log.args.category ?? ""),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
      ...challenged.map((log: any) => ({
        kind:        "challenged" as const,
        claimId:     Number(log.args.id ?? 0),
        actor:       String(log.args.challenger ?? "").toLowerCase(),
        stakeWei:    BigInt(log.args.stake ?? 0),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
      ...resolved.map((log: any) => ({
        kind:        "resolved" as const,
        claimId:     Number(log.args.id ?? 0),
        winnerSide:  Number(log.args.winnerSide ?? 0),
        confidence:  Number(log.args.confidence ?? 0),
        summary:     String(log.args.summary ?? "").slice(0, 180),
        txHash:      log.transactionHash,
        blockNumber: Number(log.blockNumber ?? 0),
      })),
    ];

    rows.sort((a, b) => b.blockNumber - a.blockNumber);
    return rows;
  } catch (err) {
    console.error("[agents] fetchEvents failed:", err);
    return [] as EventRow[];
  }
}

const fetchAgentAddresses = cachedFor(fetchAgentAddressesUncached, 20_000);

async function fetchAgentAddressesUncached() {
  const client  = createArcPublicClient();
  const address = getContractAddress();
  try {
    const [oracle, owner, oracleBal, ownerBal] = await Promise.all([
      client.readContract({ address, abi: MIMIR_ABI, functionName: "oracle" }) as Promise<`0x${string}`>,
      client.readContract({ address, abi: MIMIR_ABI, functionName: "owner"  }) as Promise<`0x${string}`>,
    ]).then(async ([oracleAddr, ownerAddr]) => {
      const [oBal, cBal] = await Promise.all([
        client.getBalance({ address: oracleAddr }),
        client.getBalance({ address: ownerAddr  }),
      ]);
      return [oracleAddr, ownerAddr, oBal, cBal] as const;
    });
    return { oracle, owner, oracleBal: oracleBal as bigint, ownerBal: ownerBal as bigint };
  } catch (err) {
    console.error("[agents] fetchAgentAddresses failed:", err);
    return null;
  }
}

/* ── UI bits ─────────────────────────────────────────────────────────────── */

function AgentPeep({
  seed,
  label,
  tone,
}: {
  seed: string;
  label: string;
  tone: "emerald" | "neutral";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-pv-emerald/40 bg-pv-emerald/[0.08] shadow-[0_0_28px_rgba(51,79,169,0.18)]"
      : "border-pv-border/60 bg-pv-surface2/70 shadow-[0_0_24px_rgba(255,255,255,0.05)]";

  return (
    <div className={`flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border ${toneClass}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={openPeepsAvatar(seed)}
        alt={`${label} avatar`}
        className="h-full w-full object-cover object-top opacity-95"
      />
    </div>
  );
}

const SIDE_LABEL: Record<number, string> = {
  1: "creator won",
  2: "challengers won",
  3: "draw · refunded",
  4: "unresolvable · refunded",
};

function ActorTag({
  addr,
  oracle,
  creator,
}: { addr: string; oracle?: string; creator?: string }) {
  const actor = classifyActor(addr, oracle, creator);
  if (actor.kind === "oracle") {
    return <span className="inline-flex items-center rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">oracle</span>;
  }
  if (actor.kind === "market-creator") {
    return <span className="inline-flex items-center rounded-md border border-pv-border/60 bg-pv-surface2/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text/80">market-creator</span>;
  }
  if (actor.kind === "council") {
    const p = actor.persona;
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-pv-border/50 bg-pv-surface2/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text/80">
        <span className="text-[11px] leading-none grayscale opacity-75">{p.emoji}</span>
        <span>{p.displayName.replace(/^The /, "")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center rounded-md border border-pv-fuch/40 bg-pv-fuch/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-fuch">human</span>
      <span className="font-mono text-[11px] text-pv-muted">{shortenAddress(addr)}</span>
    </span>
  );
}

function tierPill(c: number) {
  if (c >= 80) return { label: "FIRM", cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED", cls: "border-pv-border/60 bg-pv-surface2/60 text-pv-text/80" };
  if (c > 0)   return { label: "LOW", cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700" };
  return { label: "—", cls: "border-pv-border/40 bg-pv-surface2/40 text-pv-muted" };
}

/* ── Page ────────────────────────────────────────────────────────────────── */

function parseFilter(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v ?? "all";
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string | string[] }>;
}) {
  const [events, agentInfo, sp] = await Promise.all([
    fetchEvents(),
    fetchAgentAddresses(),
    searchParams ?? Promise.resolve({} as { filter?: string | string[] }),
  ]);
  const filter = parseFilter(sp?.filter);
  const councilPersonas = getActiveCouncilPersonas();

  const isOracle  = (a: string) => !!agentInfo && a.toLowerCase() === agentInfo.oracle.toLowerCase();
  const isCreator = (a: string) => !!agentInfo && a.toLowerCase() === agentInfo.owner.toLowerCase();
  const isCouncil = (a: string) => getPersonaForAddress(a) !== null;
  /** Resolved events have no .actor (oracle implied); created/challenged carry the staker address. */
  const eventActor = (e: EventRow): string | null =>
    e.kind === "resolved" ? null : e.actor;
  const isAgentEvent = (e: EventRow) => {
    if (e.kind === "resolved") return true;
    const a = eventActor(e);
    if (!a) return false;
    if (e.kind === "challenged") return isOracle(a) || isCouncil(a);
    if (e.kind === "created")    return isCreator(a);
    return false;
  };
  const isHumanEvent = (e: EventRow) => !isAgentEvent(e);

  const agentEvents   = events.filter(isAgentEvent);
  const humanEvents   = events.filter(isHumanEvent);
  const councilEvents = events.filter((e) => {
    const a = eventActor(e);
    return a !== null && isCouncil(a);
  });

  // Per-persona filter slugs come in as filter=persona:<slug>
  const personaFilter = filter.startsWith("persona:") ? filter.slice("persona:".length) : null;
  const visibleEvents = (() => {
    if (personaFilter) {
      const matchAddr = councilPersonas.find((p) => p.persona.slug === personaFilter)?.address.toLowerCase();
      if (!matchAddr) return [];
      return events.filter((e) => {
        const a = eventActor(e);
        return a !== null && a.toLowerCase() === matchAddr;
      });
    }
    if (filter === "agents")  return agentEvents;
    if (filter === "humans")  return humanEvents;
    if (filter === "council") return councilEvents;
    return events;
  })();

  const humanStakerSet = new Set<string>();
  for (const e of humanEvents) {
    if (e.kind === "created" || e.kind === "challenged") {
      humanStakerSet.add(e.actor.toLowerCase());
    }
  }
  const humanStakerCount = humanStakerSet.size;

  const oracleSettlements    = events.filter((e) => e.kind === "resolved").length;
  const oracleChallenges     = events.filter((e) => e.kind === "challenged" && isOracle(e.actor)).length;
  const creatorMarketsOpened = events.filter((e) => e.kind === "created" && isCreator(e.actor)).length;

  return (
    <div className="pb-10">
      <BlueprintHeading>AI agents and humans, side by side</BlueprintHeading>
      <div className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="mx-auto max-w-2xl text-center text-sm text-pv-muted">
          Every row is a real on-chain transaction. Agents sign through Circle&apos;s
          Programmable Wallets; humans through their own wallets. Cached for 20 seconds.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[11px] font-mono uppercase tracking-[0.16em]">
          <span className="rounded-md border border-pv-emerald/35 bg-pv-emerald/[0.06] px-2 py-1 text-pv-emerald">
            {agentEvents.length} agent
          </span>
          {councilEvents.length > 0 && (
            <span className="rounded-md border border-amber-400/35 bg-amber-400/[0.06] px-2 py-1 text-amber-700">
              {councilEvents.length} council ({councilPersonas.length} personas)
            </span>
          )}
          <span className="rounded-md border border-pv-fuch/35 bg-pv-fuch/[0.06] px-2 py-1 text-pv-fuch">
            {humanEvents.length} human · {humanStakerCount} unique
          </span>
          <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
            {events.length} total
          </span>
        </div>
      </header>

      {/* Agent profiles */}
      {agentInfo && (
        <section className="mb-10 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.05] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <AgentPeep seed={`mimir-oracle-${agentInfo.oracle}`} label="Oracle agent" tone="emerald" />
              <span className="rounded-md border border-pv-emerald/35 bg-pv-emerald/[0.08] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
                Settler
              </span>
            </div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">Oracle agent</span>
              <a href={getExplorerAddressUrl(agentInfo.oracle)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[11px] text-pv-muted hover:text-pv-emerald">
                {shortenAddress(agentInfo.oracle)} ↗
              </a>
            </div>
            <p className="mt-1 text-sm text-pv-text/85">
              Reads expired claims, fetches evidence, asks an LLM, and settles. With auto-challenger on, also stakes USDC on mispriced open claims using Kelly.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">Balance</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{weiToUsdc(agentInfo.oracleBal).toFixed(2)} <span className="text-xs text-pv-muted">USDC</span></div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">Settled</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{oracleSettlements}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">Auto-stakes</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{oracleChallenges}</div>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-pv-border/40 bg-pv-surface/70 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <AgentPeep seed={`mimir-market-creator-${agentInfo.owner}`} label="Market-creator agent" tone="neutral" />
              <span className="rounded-md border border-pv-border/50 bg-pv-surface2/60 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/70">
                Builder
              </span>
            </div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-text/80">Market-creator agent</span>
              <a href={getExplorerAddressUrl(agentInfo.owner)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[11px] text-pv-muted hover:text-pv-emerald">
                {shortenAddress(agentInfo.owner)} ↗
              </a>
            </div>
            <p className="mt-1 text-sm text-pv-text/85">
              Polls public sources (CoinGecko, ESPN, OpenWeather) every 6h, asks an LLM to draft verifiable claim candidates, and opens the highest-scoring ones with its own creator-side stake.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/60">Balance</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{weiToUsdc(agentInfo.ownerBal).toFixed(2)} <span className="text-xs text-pv-muted">USDC</span></div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/60">Markets opened</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{creatorMarketsOpened}</div>
              </div>
            </div>
          </article>
        </section>
      )}

      {/* Combined live feed */}
      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">Live feed</h2>
          <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.16em]">
            {[
              { key: "all",     label: `All · ${events.length}` },
              { key: "agents",  label: `Agents · ${agentEvents.length}` },
              { key: "council", label: `Council · ${councilEvents.length}` },
              { key: "humans",  label: `Humans · ${humanEvents.length}` },
            ].map(({ key, label }) => {
              const active = filter === key;
              const href = key === "all" ? "?" : `?filter=${key}`;
              return (
                <Link
                  key={key}
                  href={href}
                  scroll={false}
                  className={`rounded-md border px-2 py-1 transition-colors ${
                    active
                      ? "border-pv-emerald bg-pv-emerald/[0.10] text-pv-emerald"
                      : "border-pv-border/40 bg-pv-surface2/40 text-pv-muted hover:border-pv-emerald/40 hover:text-pv-text"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
            {councilPersonas.length > 0 && (
              <details className="relative">
                <summary className={`cursor-pointer list-none rounded-md border px-2 py-1 transition-colors ${
                  personaFilter
                    ? "border-pv-emerald bg-pv-emerald/[0.10] text-pv-emerald"
                    : "border-pv-border/40 bg-pv-surface2/40 text-pv-muted hover:border-pv-emerald/40 hover:text-pv-text"
                }`}>
                  {personaFilter
                    ? councilPersonas.find((p) => p.persona.slug === personaFilter)?.persona.displayName.replace(/^The /, "") ?? "Persona"
                    : "Pick persona ▾"}
                </summary>
                <div className="absolute right-0 z-10 mt-1 min-w-[200px] rounded-lg border border-pv-border/50 bg-pv-surface p-1 shadow-lg">
                  {councilPersonas.map(({ persona }) => (
                    <Link
                      key={persona.slug}
                      href={`?filter=persona:${persona.slug}`}
                      scroll={false}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-pv-surface2/60"
                    >
                      <span className="text-base leading-none grayscale opacity-75">{persona.emoji}</span>
                      <span className="text-pv-text/90 normal-case">{persona.displayName}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </nav>
        </div>
        {visibleEvents.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            {filter === "humans"
              ? "No human stakers yet. Be the first — open a claim from /vs/create or challenge an open market."
              : filter === "agents"
              ? "No on-chain agent activity yet. Once the oracle settles or the market-creator opens a claim, events stream here."
              : "No on-chain activity yet."}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleEvents.map((e, i) => (
              <li key={`${e.kind}-${e.claimId}-${e.txHash}-${i}`} className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">block #{e.blockNumber}</span>
                  <span className="font-mono text-[11px] text-pv-emerald">claim #{e.claimId}</span>
                  {e.kind === "created" && (
                    <>
                      <ActorTag addr={e.actor} oracle={agentInfo?.oracle} creator={agentInfo?.owner} />
                      <span className="text-[13px] font-bold text-pv-text">opened a market</span>
                      <span className="text-[11px] text-pv-muted">· {e.category}</span>
                    </>
                  )}
                  {e.kind === "challenged" && (
                    <>
                      <ActorTag addr={e.actor} oracle={agentInfo?.oracle} creator={agentInfo?.owner} />
                      <span className="text-[13px] font-bold text-pv-text">staked the contrarian side</span>
                      <span className="text-[11px] font-mono text-pv-text/85">{weiToUsdc(e.stakeWei).toFixed(2)} USDC</span>
                    </>
                  )}
                  {e.kind === "resolved" && (() => {
                    const t = tierPill(e.confidence);
                    return (
                      <>
                        <span className="inline-flex items-center rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">oracle</span>
                        <span className="text-[13px] font-bold text-pv-text">resolved · {SIDE_LABEL[e.winnerSide] ?? "unknown"}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${t.cls}`}>{t.label} · {e.confidence}%</span>
                      </>
                    );
                  })()}
                  <a href={getExplorerTxUrl(e.txHash)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[10px] text-pv-muted hover:text-pv-emerald">tx ↗</a>
                </div>
                {e.kind === "resolved" && e.summary && (
                  <p className="mt-2 text-[12px] leading-relaxed text-pv-text/75">{e.summary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 text-center">
        <Link href="/stats" className="text-sm text-pv-muted transition-colors hover:text-pv-text">View aggregate stats →</Link>
      </div>
      </div>
    </div>
  );
}
