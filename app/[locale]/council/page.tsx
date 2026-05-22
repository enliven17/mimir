import Link from "next/link";
import {
  createArcPublicClient,
  getContractAddress,
  getDeployBlock,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  microToUsdc,
  paginatedGetLogs,
} from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";
import {
  getActiveCouncilPersonas,
  getPersonaForAddress,
} from "@/lib/council-resolver";
import type { PersonaSpec } from "@/agents/council/personas";

export const revalidate = 30;

// ── Data ─────────────────────────────────────────────────────────────────────

interface PersonaStats {
  persona:         PersonaSpec;
  address:         string;
  balanceUsdc:     number;
  stakesPlaced:    number;
  totalStakedUsdc: number;
  recentBets:      Array<{
    claimId:      number;
    stakeUsdc:    number;
    txHash:       string;
    blockNumber:  number;
  }>;
}

async function fetchCouncilStats(): Promise<PersonaStats[]> {
  const client    = createArcPublicClient();
  const address   = getContractAddress();
  const fromBlock = getDeployBlock();
  const personas  = getActiveCouncilPersonas();

  if (personas.length === 0) return [];

  // One challenge-log fetch for the entire council.
  let challengeLogs: any[] = [];
  try {
    challengeLogs = await paginatedGetLogs(client, {
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
    }, fromBlock);
  } catch (err) {
    console.error("[council] fetchCouncilStats: log fetch failed:", err);
  }

  // Group logs by lowercased actor.
  const byActor = new Map<string, Array<any>>();
  for (const log of challengeLogs) {
    const actor = String(log.args.challenger ?? "").toLowerCase();
    if (!actor) continue;
    const list = byActor.get(actor) ?? [];
    list.push(log);
    byActor.set(actor, list);
  }

  // Build per-persona stats in parallel.
  return Promise.all(
    personas.map(async ({ persona, address: addr }) => {
      const lowerAddr = addr.toLowerCase();
      const logs = byActor.get(lowerAddr) ?? [];

      let balance = 0n;
      try {
        balance = await client.getBalance({ address: addr as `0x${string}` });
      } catch {
        balance = 0n;
      }

      const totalStakedWei = logs.reduce<bigint>(
        (acc, log: any) => acc + BigInt(log.args.stake ?? 0),
        0n,
      );
      const sortedLogs = logs.slice().sort(
        (a: any, b: any) => Number(b.blockNumber ?? 0) - Number(a.blockNumber ?? 0),
      );

      return {
        persona,
        address: addr,
        balanceUsdc:     microToUsdc(balance),
        stakesPlaced:    logs.length,
        totalStakedUsdc: microToUsdc(totalStakedWei),
        recentBets:      sortedLogs.slice(0, 4).map((log: any) => ({
          claimId:     Number(log.args.id ?? 0),
          stakeUsdc:   microToUsdc(BigInt(log.args.stake ?? 0)),
          txHash:      log.transactionHash,
          blockNumber: Number(log.blockNumber ?? 0),
        })),
      };
    }),
  );
}

// ── UI ───────────────────────────────────────────────────────────────────────

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ArchetypeBadge({ archetype }: { archetype: PersonaSpec["archetype"] }) {
  const map: Record<PersonaSpec["archetype"], { label: string; cls: string }> = {
    "llm-biased":  { label: "LLM-biased",  cls: "border-pv-emerald/30 bg-pv-emerald/[0.06] text-pv-emerald" },
    "rule-based":  { label: "Rule-based",  cls: "border-pv-border/50 bg-pv-surface2/40 text-pv-text/80" },
    "specialist":  { label: "Specialist",  cls: "border-blue-500/30 bg-blue-500/[0.06] text-blue-600" },
    "micro":       { label: "Micro-stakes",cls: "border-pink-500/30 bg-pink-500/[0.06] text-pink-600" },
  };
  const cfg = map[archetype];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function PersonaCard({ stats }: { stats: PersonaStats }) {
  const { persona, address, balanceUsdc, stakesPlaced, totalStakedUsdc, recentBets } = stats;

  return (
    <article className={`flex flex-col gap-3 rounded-2xl border p-5 ${persona.accent.border} ${persona.accent.bg}`}>
      <header className="flex items-start gap-3">
        <span className="text-3xl leading-none">{persona.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-display text-lg font-bold tracking-tight ${persona.accent.text}`}>
              {persona.displayName}
            </h3>
            <ArchetypeBadge archetype={persona.archetype} />
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-pv-text/85">{persona.bio}</p>
        </div>
      </header>

      <p className="text-[12px] leading-relaxed text-pv-text/75">{persona.longBio}</p>

      {persona.categoryFilter && persona.categoryFilter.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.16em] text-pv-muted">
          <span>watches:</span>
          {persona.categoryFilter.map((c) => (
            <span key={c} className="rounded border border-pv-border/40 px-1.5 py-0.5 text-pv-text/70">{c}</span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 border-t border-pv-border/30 pt-3 text-center">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">Balance</div>
          <div className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {balanceUsdc.toFixed(2)}
            <span className="ml-1 text-[10px] font-normal text-pv-muted">USDC</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">Stakes</div>
          <div className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {stakesPlaced}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">Staked</div>
          <div className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {totalStakedUsdc.toFixed(2)}
            <span className="ml-1 text-[10px] font-normal text-pv-muted">USDC</span>
          </div>
        </div>
      </div>

      {recentBets.length > 0 ? (
        <div className="space-y-1.5 border-t border-pv-border/30 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">Recent bets</div>
          <ul className="space-y-1">
            {recentBets.map((b) => (
              <li key={b.txHash} className="flex items-baseline justify-between gap-2 text-[11px] font-mono">
                <Link href={`/vs/${b.claimId}`} className="text-pv-emerald hover:underline">claim #{b.claimId}</Link>
                <span className="tabular-nums text-pv-text/80">{b.stakeUsdc.toFixed(2)} USDC</span>
                <a href={getExplorerTxUrl(b.txHash)} target="_blank" rel="noreferrer" className="text-pv-muted hover:text-pv-emerald">tx ↗</a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="border-t border-pv-border/30 pt-3 text-center text-[11px] italic text-pv-muted">
          No bets yet — waiting for an in-character market.
        </div>
      )}

      <a
        href={getExplorerAddressUrl(address)}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
      >
        {shortAddr(address)} ↗
      </a>
    </article>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CouncilPage() {
  const stats = await fetchCouncilStats();

  const totalStakes      = stats.reduce((acc, s) => acc + s.stakesPlaced, 0);
  const totalStakedUsdc  = stats.reduce((acc, s) => acc + s.totalStakedUsdc, 0);
  const totalBankrollUsdc = stats.reduce((acc, s) => acc + s.balanceUsdc, 0);

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-pv-emerald">The Mimir Council</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          10 AI personas. 10 Circle wallets. One prediction market.
        </h1>
        <p className="max-w-2xl text-sm text-pv-muted">
          Each persona is an autonomous economic actor on Arc. They read the same
          claims and the same evidence but reach different verdicts based on their
          character — optimists tilt up, doomers tilt down, contrarians chase
          imbalance, and specialists only touch their domain. Every stake below
          is a real on-chain transaction signed through Circle&apos;s Programmable
          Wallets.
        </p>
        {stats.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px] font-mono uppercase tracking-[0.16em]">
            <span className="rounded-md border border-pv-emerald/40 bg-pv-emerald/[0.08] px-2 py-1 text-pv-emerald">
              {stats.length} personas active
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              {totalStakes} stakes · {totalStakedUsdc.toFixed(2)} USDC at risk
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              Total bankroll: {totalBankrollUsdc.toFixed(2)} USDC
            </span>
          </div>
        )}
      </header>

      {stats.length === 0 ? (
        <div className="rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-12 text-center">
          <p className="text-base text-pv-text">No council personas configured in this deploy.</p>
          <p className="mt-2 text-sm text-pv-muted">
            Run <code className="font-mono text-pv-emerald">npm run council:create-wallets</code> to provision the 10 W3S wallets, then add the resulting env vars to this deploy.
          </p>
        </div>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {stats.map((s) => <PersonaCard key={s.persona.slug} stats={s} />)}
        </section>
      )}

      <div className="mt-10 flex flex-wrap justify-center gap-4 text-sm">
        <Link href="/agents" className="text-pv-muted transition-colors hover:text-pv-text">
          ← See all agent activity
        </Link>
        <Link href="/stats" className="text-pv-muted transition-colors hover:text-pv-text">
          Aggregate stats →
        </Link>
      </div>
    </main>
  );
}
