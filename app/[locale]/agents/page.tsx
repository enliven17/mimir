import Link from "next/link";
import {
  createArcPublicClient,
  getContractAddress,
  getDeployBlock,
  paginatedGetLogs,
  microToUsdc,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";

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

async function fetchEvents() {
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

async function fetchAgentAddresses() {
  const client  = createArcPublicClient();
  const address = getContractAddress();
  try {
    const [oracle, owner, oracleBal, ownerBal] = await Promise.all([
      client.readContract({ address, abi: MIMIR_ABI, functionName: "oracle" }) as Promise<`0x${string}`>,
      client.readContract({ address, abi: MIMIR_ABI, functionName: "owner"  }) as Promise<`0x${string}`>,
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

function shortAddr(a: string): string {
  if (!a || a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

const SIDE_LABEL: Record<number, string> = {
  1: "creator won",
  2: "challengers won",
  3: "draw · refunded",
  4: "unresolvable · refunded",
};

function ActorTag({ addr, oracle, creator }: { addr: string; oracle?: string; creator?: string }) {
  const norm = addr.toLowerCase();
  if (norm === oracle?.toLowerCase()) {
    return <span className="inline-flex items-center rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald">oracle</span>;
  }
  if (norm === creator?.toLowerCase()) {
    return <span className="inline-flex items-center rounded-md border border-pv-border/60 bg-pv-surface2/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-text/80">market-creator</span>;
  }
  return <span className="font-mono text-[11px] text-pv-muted">{shortAddr(addr)}</span>;
}

function tierPill(c: number) {
  if (c >= 80) return { label: "FIRM", cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED", cls: "border-pv-border/60 bg-pv-surface2/60 text-pv-text/80" };
  if (c > 0)   return { label: "LOW", cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700" };
  return { label: "—", cls: "border-pv-border/40 bg-pv-surface2/40 text-pv-muted" };
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default async function AgentsPage() {
  const [events, agentInfo] = await Promise.all([fetchEvents(), fetchAgentAddresses()]);

  // Agent-specific filters
  const isOracle    = (a: string) => agentInfo && a.toLowerCase() === agentInfo.oracle.toLowerCase();
  const isCreator   = (a: string) => agentInfo && a.toLowerCase() === agentInfo.owner.toLowerCase();
  const agentEvents = events.filter((e) =>
    e.kind === "resolved" ||
    (e.kind === "challenged" && isOracle(e.actor)) ||
    (e.kind === "created" && isCreator(e.actor)),
  );

  const oracleSettlements   = events.filter((e) => e.kind === "resolved").length;
  const oracleChallenges    = events.filter((e) => e.kind === "challenged" && isOracle(e.actor)).length;
  const creatorMarketsOpened = events.filter((e) => e.kind === "created" && isCreator(e.actor)).length;
  const creatorAvgStake = (() => {
    const created = events.filter((e) => e.kind === "created" && isCreator(e.actor));
    if (created.length === 0) return 0;
    // No stake in ClaimCreated event — leave as 0 or hide
    return 0;
  })();

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">Agent activity log</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          What the AI agents have actually done
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          Live on-chain event feed for Mimir&apos;s two autonomous agents. Every
          row is a real transaction signed through Circle&apos;s Programmable
          Wallets. Cached for 20 seconds.
        </p>
      </header>

      {/* Agent profiles */}
      {agentInfo && (
        <section className="mb-10 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-pv-emerald/35 bg-pv-emerald/[0.05] p-5">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">Oracle agent</span>
              <a href={getExplorerAddressUrl(agentInfo.oracle)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[11px] text-pv-muted hover:text-pv-emerald">
                {shortAddr(agentInfo.oracle)} ↗
              </a>
            </div>
            <p className="mt-1 text-sm text-pv-text/85">
              Reads expired claims, fetches evidence, asks an LLM, and settles. With auto-challenger on, also stakes USDC on mispriced open claims using Kelly.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">Balance</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{microToUsdc(agentInfo.oracleBal).toFixed(2)} <span className="text-xs text-pv-muted">USDC</span></div>
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
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-pv-text/80">Market-creator agent</span>
              <a href={getExplorerAddressUrl(agentInfo.owner)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-[11px] text-pv-muted hover:text-pv-emerald">
                {shortAddr(agentInfo.owner)} ↗
              </a>
            </div>
            <p className="mt-1 text-sm text-pv-text/85">
              Polls public sources (CoinGecko, ESPN, OpenWeather) every 6h, asks an LLM to draft verifiable claim candidates, and opens the highest-scoring ones with its own creator-side stake.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-pv-text/60">Balance</div>
                <div className="mt-0.5 font-display text-base font-bold tabular-nums text-pv-text">{microToUsdc(agentInfo.ownerBal).toFixed(2)} <span className="text-xs text-pv-muted">USDC</span></div>
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
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">Live agent feed</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-pv-muted">{agentEvents.length} agent events · {events.length} total</span>
        </div>
        {agentEvents.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            No on-chain agent activity yet. Once the oracle settles or the market-creator opens a claim, events stream here.
          </div>
        ) : (
          <ul className="space-y-3">
            {agentEvents.map((e, i) => (
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
                      <span className="text-[11px] font-mono text-pv-text/85">{microToUsdc(e.stakeWei).toFixed(2)} USDC</span>
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
    </main>
  );
}
