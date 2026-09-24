import { Link } from "@/i18n/navigation";
import {
  enabledChainKeys,
  explorerAddressUrl,
  explorerTxUrl,
  stakeUnitsToUsdc,
  vsPath,
  type ChainKey,
} from "@/lib/chains";
import ChainBadge from "@/components/ui/ChainBadge";
import {
  CLAIM_CHALLENGED_EVENT,
  acrossChains,
  blockClock,
  scanEvent,
  usdcBalance,
} from "../_lib/chainScan";
import {
  getActiveCouncilPersonas,
} from "@/lib/council-resolver";
import type { PersonaSpec } from "@/agents/council/personas";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { openPeepsAvatar } from "@/lib/avatars";
import { shortenAddress } from "@/lib/constants";
import { cachedFor } from "@/lib/server/ttl-cache";

/**
 * Rendered per request, not prerendered.
 *
 * Building this page statically means scanning the contract's whole log history
 * at build time, which grew past the 60s export budget once the roster reached
 * twenty personas. Per-request rendering with a short cache gives the same
 * freshness without putting a chain scan on the critical path of a deploy.
 */
export const dynamic = "force-dynamic";
export const revalidate = 30;

// ── Data ─────────────────────────────────────────────────────────────────────

interface CouncilBet {
  chain:        ChainKey;
  claimId:      number;
  stakeUsdc:    number;
  txHash:       string;
  blockNumber:  number;
  /** Approximate unix seconds, for ordering bets across chains. */
  ts:           number;
}

interface PersonaStats {
  persona:         PersonaSpec;
  address:         string;
  /** USDC bankroll summed over every deployed chain. */
  balanceUsdc:     number;
  /** Networks this persona holds USDC on, for the per-card labels. */
  fundedChains:    ChainKey[];
  stakesPlaced:    number;
  totalStakedUsdc: number;
  recentBets:      CouncilBet[];
}

// force-dynamic makes `revalidate` a no-op, so without this every view re-ran
// a full log scan on every chain plus a balance read per persona.
const cachedCouncilStats = cachedFor(fetchCouncilStats, 30_000);

async function fetchCouncilStats(): Promise<PersonaStats[]> {
  const personas  = getActiveCouncilPersonas();

  if (personas.length === 0) return [];

  // Each chain's challenge history, tagged with its chain and an approximate
  // time. A chain that fails to scan only drops its own bets.
  const perChain = await acrossChains("council", async (chain) => {
    const [logs, clock] = await Promise.all([
      scanEvent(chain, CLAIM_CHALLENGED_EVENT),
      blockClock(chain),
    ]);
    return logs.map((log: any): CouncilBet & { actor: string } => {
      const blockNumber = Number(log.blockNumber ?? 0);
      return {
        chain,
        actor:       String(log.args.challenger ?? "").toLowerCase(),
        claimId:     Number(log.args.id ?? 0),
        stakeUsdc:   stakeUnitsToUsdc(chain, BigInt(log.args.stake ?? 0)),
        txHash:      log.transactionHash,
        blockNumber,
        ts:          clock(blockNumber),
      };
    });
  });

  const byActor = new Map<string, CouncilBet[]>();
  for (const bet of perChain.flatMap((r) => r.value)) {
    if (!bet.actor) continue;
    const list = byActor.get(bet.actor) ?? [];
    list.push(bet);
    byActor.set(bet.actor, list);
  }

  return Promise.all(
    personas.map(async ({ persona, address: addr }) => {
      const bets = byActor.get(addr.toLowerCase()) ?? [];

      const balances = await Promise.all(
        enabledChainKeys().map(async (chain) => {
          try {
            return { chain, usdc: await usdcBalance(chain, addr as `0x${string}`) };
          } catch {
            return { chain, usdc: 0 };
          }
        }),
      );

      const sortedBets = bets
        .slice()
        .sort((a, b) => b.ts - a.ts || b.blockNumber - a.blockNumber);

      return {
        persona,
        address: addr,
        balanceUsdc:     balances.reduce((acc, b) => acc + b.usdc, 0),
        fundedChains:    balances.filter((b) => b.usdc > 0).map((b) => b.chain),
        stakesPlaced:    bets.length,
        totalStakedUsdc: bets.reduce((acc, b) => acc + b.stakeUsdc, 0),
        recentBets:      sortedBets.slice(0, 3),
      };
    }),
  );
}

// ── UI ───────────────────────────────────────────────────────────────────────

const ARCHETYPE_LABEL: Record<PersonaSpec["archetype"], string> = {
  "llm-biased":  "LLM · biased",
  "rule-based":  "Rule · no LLM",
  "specialist":  "Specialist · category-filtered",
  "micro":       "Micro · low threshold",
};

function PersonaCard({ stats }: { stats: PersonaStats }) {
  const { persona, address, balanceUsdc, fundedChains, stakesPlaced, totalStakedUsdc, recentBets } = stats;
  const active = stakesPlaced > 0;

  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-pv-border/30 bg-pv-surface/70 p-5 transition-colors hover:border-pv-border/60">
      <header className="flex items-start gap-3">
        <span
          className={`relative flex size-14 shrink-0 items-center justify-center rounded-2xl border ${persona.accent.border} ${persona.accent.bg}`}
          aria-hidden
        >
          <span className="absolute inset-0 overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={openPeepsAvatar(`council-${persona.slug}`)}
              alt=""
              className="h-full w-full object-cover object-top opacity-95"
            />
          </span>
          <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border border-pv-bg bg-pv-surface2 text-[13px] leading-none shadow-[0_4px_12px_rgba(0,0,0,0.35)]">
            {persona.emoji}
          </span>
        </span>
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

      {fundedChains.length > 0 ? (
        <div className="-mt-2 flex flex-wrap justify-center gap-1">
          {fundedChains.map((c) => <ChainBadge key={c} chain={c} compact />)}
        </div>
      ) : null}

      {recentBets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-pv-border/30 pt-3">
          {recentBets.map((b) => (
            <li key={`${b.chain}-${b.txHash}`} className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
              <span className="inline-flex items-center gap-1.5">
                <ChainBadge chain={b.chain} compact />
                <Link href={vsPath(b.claimId, b.chain)} className="text-pv-emerald hover:underline">
                  claim #{b.claimId}
                </Link>
              </span>
              <span className="tabular-nums text-pv-text/85">{b.stakeUsdc.toFixed(2)} USDC</span>
              <a
                href={explorerTxUrl(b.chain, b.txHash)}
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
        href={explorerAddressUrl(fundedChains[0] ?? "arc", address)}
        target="_blank"
        rel="noreferrer"
        className="text-center font-mono text-[10px] text-pv-muted hover:text-pv-emerald"
      >
        {shortenAddress(address)} ↗
      </a>
    </article>
  );
}

/** Render order for the two juries, with the line that explains each one. */
const TRACKS: Array<{ track: "classic" | "philosopher"; title: string; blurb: string }> = [
  {
    track: "classic",
    title: "The classic jury",
    blurb:
      "Ten temperaments. Two of them never call a model at all: the Contrarian stakes the smaller pool and the Whale-Watcher copies the largest individual challenger, both on pure rules.",
  },
  {
    track: "philosopher",
    title: "The philosopher jury",
    blurb:
      "Ten epistemic frames rather than ten moods. Asking whether a claim is true of a Bayesian, a tail-risk sceptic and a systems thinker produces genuinely different readings of the same evidence.",
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CouncilPage() {
  const stats = await cachedCouncilStats();

  const totalStakes       = stats.reduce((acc, s) => acc + s.stakesPlaced, 0);
  const totalStakedUsdc   = stats.reduce((acc, s) => acc + s.totalStakedUsdc, 0);
  const totalBankrollUsdc = stats.reduce((acc, s) => acc + s.balanceUsdc, 0);

  return (
    <div className="pb-10">
      <BlueprintHeading>Two juries. One market.</BlueprintHeading>
      <div className="mx-auto max-w-[1200px] px-4 pt-6 sm:px-6 lg:px-8">
      <header className="mb-10 space-y-1.5">
        <p className="mx-auto max-w-2xl text-center text-sm text-pv-muted">
          Every persona reads the same claim and the same evidence, and reaches a different
          verdict. The classic jury disagrees about mood: optimists tilt up, doomers tilt
          down, contrarians chase imbalance, specialists only touch their domain. The
          philosopher jury disagrees about what counts as knowing: a base rate, a mechanism,
          a tail, an inversion. Every stake below is a real on-chain transaction signed
          through Circle&apos;s Programmable Wallets.
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
        <div className="space-y-10">
          {TRACKS.map(({ track, title, blurb }) => {
            const members = stats.filter((s) => (s.persona.track ?? "classic") === track);
            if (members.length === 0) return null;
            return (
              <section key={track}>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-display text-xl font-bold tracking-tight text-pv-text">
                    {title}
                  </h2>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-pv-muted">
                    {members.length} active
                  </span>
                </div>
                <p className="mb-4 max-w-2xl text-sm text-pv-muted">{blurb}</p>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {members.map((s) => <PersonaCard key={s.persona.slug} stats={s} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <nav className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <Link href="/agents" className="text-pv-muted transition-colors hover:text-pv-text">← all agent activity</Link>
        <Link href="/stats" className="text-pv-muted transition-colors hover:text-pv-text">aggregate stats →</Link>
      </nav>
      </div>
    </div>
  );
}
