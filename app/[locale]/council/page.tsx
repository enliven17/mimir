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
import {
  getActiveCouncilPersonas,
} from "@/lib/council-resolver";
import type { PersonaSpec } from "@/agents/council/personas";
import { BlueprintHeading } from "@/components/BlueprintGrid";

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

  const byActor = new Map<string, Array<any>>();
  for (const log of challengeLogs) {
    const actor = String(log.args.challenger ?? "").toLowerCase();
    if (!actor) continue;
    const list = byActor.get(actor) ?? [];
    list.push(log);
    byActor.set(actor, list);
  }

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
        recentBets:      sortedLogs.slice(0, 3).map((log: any) => ({
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

const ARCHETYPE_LABEL: Record<PersonaSpec["archetype"], string> = {
  "llm-biased":  "LLM · biased",
  "rule-based":  "Rule · no LLM",
  "specialist":  "Specialist · category-filtered",
  "micro":       "Micro · low threshold",
};

function PersonaCard({ stats }: { stats: PersonaStats }) {
  const { persona, address, balanceUsdc, stakesPlaced, totalStakedUsdc, recentBets } = stats;
  const active = stakesPlaced > 0;

  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 transition-colors hover:border-pv-border/60">
      <header className="flex items-start gap-3">
        <span className="text-2xl leading-none grayscale opacity-75">{persona.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold tracking-tight text-pv-text">
            {persona.displayName}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-pv-muted">
            {ARCHETYPE_LABEL[persona.archetype]}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-relaxed text-pv-text/75">{persona.bio}</p>

      {persona.categoryFilter && persona.categoryFilter.length > 0 && (
        <div className="flex flex-wrap gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
          {persona.categoryFilter.map((c) => (
            <span key={c} className="rounded border border-pv-border/40 px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      )}

      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-pv-border/30 pt-3 text-center">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">balance</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {balanceUsdc.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">stakes</dt>
          <dd className={`mt-0.5 font-display text-sm font-bold tabular-nums ${active ? "text-pv-emerald" : "text-pv-text"}`}>
            {stakesPlaced}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">at risk</dt>
          <dd className="mt-0.5 font-display text-sm font-bold tabular-nums text-pv-text">
            {totalStakedUsdc.toFixed(2)}
          </dd>
        </div>
      </dl>

      {recentBets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-pv-border/30 pt-3">
          {recentBets.map((b) => (
            <li key={b.txHash} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
              <Link href={`/vs/${b.claimId}`} className="text-pv-emerald hover:underline">
                claim #{b.claimId}
              </Link>
              <span className="tabular-nums text-pv-text/85">{b.stakeUsdc.toFixed(2)} USDC</span>
              <a
                href={getExplorerTxUrl(b.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-pv-muted hover:text-pv-emerald"
              >
                tx ↗
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-pv-border/30 pt-3 text-center font-mono text-[10px] italic text-pv-muted">
          no bets yet — waiting for an in-character market
        </p>
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

  const totalStakes       = stats.reduce((acc, s) => acc + s.stakesPlaced, 0);
  const totalStakedUsdc   = stats.reduce((acc, s) => acc + s.totalStakedUsdc, 0);
  const totalBankrollUsdc = stats.reduce((acc, s) => acc + s.balanceUsdc, 0);

  return (
    <div className="pb-10">
      <BlueprintHeading>Ten AI personas. Ten Circle wallets. One market.</BlueprintHeading>
      <div className="mx-auto max-w-[1200px] px-4 pt-6 sm:px-6 lg:px-8">
      <header className="mb-10 space-y-1.5">
        <p className="mx-auto max-w-2xl text-center text-sm text-pv-muted">
          Each persona reads the same claims and the same evidence but reaches different
          verdicts based on character — optimists tilt up, doomers tilt down, contrarians
          chase imbalance, specialists only touch their domain. Every stake below is a real
          on-chain transaction signed through Circle&apos;s Programmable Wallets.
        </p>
        {stats.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2 font-mono text-[11px] uppercase tracking-[0.16em]">
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              {stats.length} active
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              {totalStakes} stakes
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              <span className="tabular-nums text-pv-text">{totalStakedUsdc.toFixed(2)}</span> usdc at risk
            </span>
            <span className="rounded-md border border-pv-border/40 bg-pv-surface2/40 px-2 py-1 text-pv-muted">
              bankroll <span className="tabular-nums text-pv-text">{totalBankrollUsdc.toFixed(2)}</span> usdc
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
        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {stats.map((s) => <PersonaCard key={s.persona.slug} stats={s} />)}
        </section>
      )}

      <nav className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link href="/agents" className="text-pv-muted transition-colors hover:text-pv-text">← all agent activity</Link>
        <Link href="/stats" className="text-pv-muted transition-colors hover:text-pv-text">aggregate stats →</Link>
      </nav>
      </div>
    </div>
  );
}
