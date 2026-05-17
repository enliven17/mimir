import Link from "next/link";
import {
  createArcPublicClient,
  getContractAddress,
  microToUsdc,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";

export const revalidate = 30;

// ── Data ─────────────────────────────────────────────────────────────────────

interface Settlement {
  id:           number;
  winnerSide:   number;
  confidence:   number;
  summary:      string;
  evidenceHash: string;
  txHash:       string;
  blockNumber:  number;
}

interface ClaimRow {
  id:                   number;
  creator:              string;
  question:             string;
  creatorStake:         bigint;
  totalChallengerStake: bigint;
  state:                number;
  winnerSide:           number;
  confidence:           number;
}

async function fetchClaims(): Promise<ClaimRow[]> {
  const client  = createArcPublicClient();
  const address = getContractAddress();

  try {
    const count = await client.readContract({
      address, abi: MIMIR_ABI, functionName: "claimCount",
    }) as bigint;
    const ids = Array.from({ length: Number(count) }, (_, i) => i + 1);
    const claims = await Promise.all(
      ids.map(async (id) => {
        try {
          const base = await client.readContract({
            address, abi: MIMIR_ABI, functionName: "getClaim", args: [BigInt(id)],
          }) as readonly any[];
          return {
            id,
            creator:              base[0] as string,
            question:             base[1] as string,
            creatorStake:         BigInt(base[5]),
            totalChallengerStake: BigInt(base[6]),
            state:                Number(base[9]),
            winnerSide:           Number(base[10]),
            confidence:           Number(base[12]),
          };
        } catch {
          return null;
        }
      }),
    );
    return claims.filter((c): c is ClaimRow => c !== null);
  } catch {
    return [];
  }
}

async function fetchSettlements(): Promise<Settlement[]> {
  const client  = createArcPublicClient();
  const address = getContractAddress();
  try {
    const logs = await client.getLogs({
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
      fromBlock: "earliest",
      toBlock:   "latest",
    });
    return logs.slice(-12).reverse().map((log: any) => ({
      id:           Number(log.args.id ?? 0),
      winnerSide:   Number(log.args.winnerSide ?? 0),
      confidence:   Number(log.args.confidence ?? 0),
      summary:      String(log.args.summary ?? "").slice(0, 180),
      evidenceHash: String(log.args.evidenceHash ?? ""),
      txHash:       log.transactionHash,
      blockNumber:  Number(log.blockNumber ?? 0),
    }));
  } catch {
    return [];
  }
}

async function fetchOracleAndCreator() {
  const client = createArcPublicClient();
  const address = getContractAddress();
  try {
    const oracle = (await client.readContract({
      address, abi: MIMIR_ABI, functionName: "oracle",
    })) as `0x${string}`;
    const owner = (await client.readContract({
      address, abi: MIMIR_ABI, functionName: "owner",
    })) as `0x${string}`;
    const [oracleBal, ownerBal] = await Promise.all([
      client.getBalance({ address: oracle }),
      client.getBalance({ address: owner }),
    ]);
    return {
      oracle, owner,
      oracleBalance: oracleBal,
      ownerBalance:  ownerBal,
    };
  } catch {
    return null;
  }
}

// ── UI primitives ────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone = "default" }: {
  label: string;
  value: string | number;
  sub?:  string;
  tone?: "default" | "accent";
}) {
  return (
    <div className={`rounded-2xl border p-4 ${
      tone === "accent"
        ? "border-pv-emerald/35 bg-pv-emerald/[0.06]"
        : "border-pv-border/30 bg-pv-surface/70"
    }`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-pv-muted">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold tracking-tight tabular-nums ${
        tone === "accent" ? "text-pv-emerald" : "text-pv-text"
      }`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-pv-muted">{sub}</div> : null}
    </div>
  );
}

function ConfidenceBar({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-bold uppercase tracking-[0.16em] text-pv-text/85">{label}</span>
        <span className="font-mono text-pv-muted">{count} · {pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-pv-surface2/60">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const SIDE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Creator won",      color: "text-pv-emerald" },
  2: { label: "Challengers won",  color: "text-pv-fuch" },
  3: { label: "Draw · refunded",  color: "text-pv-muted" },
  4: { label: "Unresolvable · refunded", color: "text-amber-600" },
};

function tierLabel(c: number): { label: string; cls: string } {
  if (c >= 80) return { label: "FIRM",      cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald" };
  if (c >= 60) return { label: "CONTESTED", cls: "border-pv-border/60 bg-pv-surface2/60 text-pv-text/80" };
  return         { label: "LOW",       cls: "border-amber-400/40 bg-amber-400/[0.10] text-amber-700" };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function StatsPage() {
  const [claims, settlements, agentInfo] = await Promise.all([
    fetchClaims(),
    fetchSettlements(),
    fetchOracleAndCreator(),
  ]);

  const totalClaims    = claims.length;
  const totalResolved  = settlements.length;
  const openClaims     = claims.filter((c) => c.state === 0 || c.state === 1).length;

  // Total wagered = creator stakes + challenger stakes across all claims, in USDC.
  const totalWageredWei = claims.reduce(
    (acc, c) => acc + c.creatorStake + c.totalChallengerStake,
    0n,
  );
  const totalWageredUsdc = microToUsdc(totalWageredWei);

  // Confidence tiers from on-chain settlement events.
  const firm      = settlements.filter((s) => s.confidence >= 80).length;
  const contested = settlements.filter((s) => s.confidence >= 60 && s.confidence < 80).length;
  const low       = settlements.filter((s) => s.confidence < 60 && s.confidence > 0).length;
  const accuracyPct =
    totalResolved > 0 ? Math.round((firm / totalResolved) * 100) : 0;

  // Refund rate: DRAW (3) or UNRESOLVABLE (4)
  const refunds  = settlements.filter((s) => s.winnerSide === 3 || s.winnerSide === 4).length;
  const refundPct = totalResolved > 0 ? Math.round((refunds / totalResolved) * 100) : 0;

  const creatorWins    = settlements.filter((s) => s.winnerSide === 1).length;
  const challengerWins = settlements.filter((s) => s.winnerSide === 2).length;
  const decided        = creatorWins + challengerWins;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">Oracle Analytics</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">Live on-chain stats</h1>
        <p className="text-sm text-pv-muted">
          Every number on this page is read directly from the Mimir contract on Arc Testnet. Cached for 30 seconds.
        </p>
      </header>

      {/* Headline KPIs */}
      <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi tone="accent" label="Total wagered" value={`${totalWageredUsdc.toFixed(2)} USDC`} sub="creator + challenger stakes" />
        <Kpi label="Claims resolved" value={totalResolved} sub={`${openClaims} open · ${totalClaims} total`} />
        <Kpi label="Oracle accuracy" value={`${accuracyPct}%`} sub="settlements at ≥ 80% confidence" />
        <Kpi label="Refund rate" value={`${refundPct}%`} sub="draw / unresolvable" />
      </section>

      {/* Two-column: confidence distribution + agent vault */}
      <section className="mb-10 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 sm:p-6">
          <h2 className="mb-1 font-display text-base font-bold tracking-tight text-pv-text">Oracle confidence distribution</h2>
          <p className="mb-5 text-xs text-pv-muted">
            How sure the oracle was when it settled. Mimir refunds the bottom band rather than guess.
          </p>
          <div className="space-y-4">
            <ConfidenceBar label="FIRM · ≥ 80%"      count={firm}      total={totalResolved} color="#D85F5F" />
            <ConfidenceBar label="CONTESTED · 60-79" count={contested} total={totalResolved} color="#F5AFAF" />
            <ConfidenceBar label="LOW · refunded"    count={low}       total={totalResolved} color="#E8C46C" />
          </div>
        </div>

        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 sm:p-6">
          <h2 className="mb-1 font-display text-base font-bold tracking-tight text-pv-text">Agent vault</h2>
          <p className="mb-5 text-xs text-pv-muted">
            The W3S-managed wallets that the oracle and market-creator sign through.
          </p>
          {agentInfo ? (
            <div className="space-y-4 text-sm">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald">Oracle</span>
                  <span className="font-mono tabular-nums text-pv-text">{microToUsdc(agentInfo.oracleBalance).toFixed(4)} USDC</span>
                </div>
                <a className="block break-all font-mono text-[10px] text-pv-muted hover:text-pv-emerald" href={getExplorerAddressUrl(agentInfo.oracle)} target="_blank" rel="noreferrer">
                  {agentInfo.oracle}
                </a>
              </div>
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald">Market-creator (owner)</span>
                  <span className="font-mono tabular-nums text-pv-text">{microToUsdc(agentInfo.ownerBalance).toFixed(4)} USDC</span>
                </div>
                <a className="block break-all font-mono text-[10px] text-pv-muted hover:text-pv-emerald" href={getExplorerAddressUrl(agentInfo.owner)} target="_blank" rel="noreferrer">
                  {agentInfo.owner}
                </a>
              </div>
              <p className="border-t border-pv-border/30 pt-3 text-[11px] leading-relaxed text-pv-muted">
                Neither wallet holds a local private key — both sign through Circle&apos;s Programmable Wallets (W3S).
              </p>
            </div>
          ) : (
            <p className="text-sm text-pv-muted">No agent info available.</p>
          )}
        </div>
      </section>

      {/* Decided side split */}
      {decided > 0 && (
        <section className="mb-10 rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 sm:p-6">
          <h2 className="mb-4 font-display text-base font-bold tracking-tight text-pv-text">Decided settlements · who won</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-pv-emerald/30 bg-pv-emerald/[0.05] p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald">Creator wins</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums text-pv-text">{creatorWins}</span>
                <span className="text-xs text-pv-muted">{Math.round((creatorWins / decided) * 100)}%</span>
              </div>
            </div>
            <div className="rounded-xl border border-pv-border/40 bg-pv-surface2/40 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-fuch">Challenger wins</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold tabular-nums text-pv-text">{challengerWins}</span>
                <span className="text-xs text-pv-muted">{Math.round((challengerWins / decided) * 100)}%</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Recent settlements feed */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">Settlement timeline</h2>
        {settlements.length === 0 ? (
          <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-8 text-center text-sm text-pv-muted">
            No settlements yet. Once the oracle resolves a claim, it appears here.
          </div>
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const side = SIDE_LABEL[s.winnerSide] ?? { label: "Unknown", color: "text-pv-muted" };
              const tier = tierLabel(s.confidence);
              return (
                <div key={s.txHash} className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono text-pv-muted">Claim #{s.id}</span>
                        <span className={`font-bold ${side.color}`}>{side.label}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-bold uppercase tracking-[0.14em] ${tier.cls}`}>{tier.label} · {s.confidence}%</span>
                      </div>
                      <p className="line-clamp-2 text-[13px] text-pv-text/85">{s.summary}</p>
                      {s.evidenceHash &&
                        s.evidenceHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wide text-pv-muted">Evidence hash:</span>
                            <span className="max-w-[260px] truncate font-mono text-[10px] text-pv-emerald/85">{s.evidenceHash}</span>
                          </div>
                        )}
                    </div>
                    <a
                      href={getExplorerTxUrl(s.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg border border-pv-border/40 px-2 py-1 text-[11px] text-pv-muted transition-colors hover:border-pv-emerald hover:text-pv-emerald"
                    >
                      View tx ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Resource links */}
      <section className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-6">
        <h3 className="mb-4 font-display text-lg font-bold tracking-tight text-pv-text">Get testnet USDC</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Circle Faucet",  href: "https://faucet.circle.com",         desc: "Testnet USDC on Arc and CCTP V2 chains" },
            { label: "Arc Explorer",   href: "https://testnet.arcscan.app",       desc: "Inspect contract activity" },
            { label: "Bridge",         href: "/bridge",                            desc: "CCTP V2 to pull USDC into Arc" },
          ].map(({ label, href, desc }) => {
            const isExternal = href.startsWith("http");
            const linkProps = isExternal
              ? { href, target: "_blank", rel: "noreferrer" as const }
              : { href };
            return (
              <a
                key={href}
                {...linkProps}
                className="rounded-xl border border-pv-border/30 p-3 transition-all hover:border-pv-emerald/40 hover:bg-pv-emerald/[0.04]"
              >
                <div className="text-[13px] font-semibold text-pv-text">{label} {isExternal ? "↗" : "→"}</div>
                <div className="mt-0.5 text-[12px] text-pv-muted">{desc}</div>
              </a>
            );
          })}
        </div>
      </section>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-pv-muted transition-colors hover:text-pv-text">
          ← Back to markets
        </Link>
      </div>
    </main>
  );
}
