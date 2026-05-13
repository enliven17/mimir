import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { createArcPublicClient, getContractAddress, microToUsdc } from "@/lib/arc";
import { MIMIR_ABI } from "@/lib/mimir-abi";

export const revalidate = 30;

async function fetchPlatformStats() {
  const client = createArcPublicClient();
  const address = getContractAddress();

  try {
    const [stats, balance, oracleAddress] = await Promise.all([
      client.readContract({ address, abi: MIMIR_ABI, functionName: "getPlatformStats" }) as Promise<[bigint, bigint, bigint]>,
      client.getBalance({ address }),
      client.readContract({ address, abi: MIMIR_ABI, functionName: "oracle" }) as Promise<string>,
    ]);

    const [totalClaims, totalResolved, _contractBalance] = stats;
    const oracleBalance = await client.getBalance({ address: oracleAddress as `0x${string}` }).catch(() => BigInt(0));

    return {
      totalClaims:    Number(totalClaims),
      totalResolved:  Number(totalResolved),
      openClaims:     Number(totalClaims) - Number(totalResolved),
      resolutionRate: totalClaims > 0n ? Math.round((Number(totalResolved) / Number(totalClaims)) * 100) : 0,
      contractBalance: microToUsdc(balance),
      oracleAddress,
      oracleBalance: microToUsdc(oracleBalance),
    };
  } catch {
    return null;
  }
}

async function fetchRecentSettlements() {
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

    return logs.slice(-10).reverse().map((log: any) => ({
      id:           Number(log.args.id ?? 0),
      winnerSide:   Number(log.args.winnerSide ?? 0),
      confidence:   Number(log.args.confidence ?? 0),
      summary:      (log.args.summary as string ?? "").slice(0, 120),
      evidenceHash: log.args.evidenceHash as string,
      txHash:       log.transactionHash,
      blockNumber:  Number(log.blockNumber ?? 0),
    }));
  } catch {
    return [];
  }
}

const SIDE_LABEL: Record<number, { label: string; color: string }> = {
  1: { label: "Creator Won",       color: "text-pv-cyan" },
  2: { label: "Challengers Won",   color: "text-pv-fuch" },
  3: { label: "Draw",              color: "text-pv-muted" },
  4: { label: "Unresolvable",      color: "text-amber-400" },
};

export default async function StatsPage() {
  const [stats, settlements] = await Promise.all([
    fetchPlatformStats(),
    fetchRecentSettlements(),
  ]);

  const avgConfidence = settlements.length > 0
    ? Math.round(settlements.reduce((sum, s) => sum + s.confidence, 0) / settlements.length)
    : 0;

  const creatorWins      = settlements.filter((s) => s.winnerSide === 1).length;
  const challengerWins   = settlements.filter((s) => s.winnerSide === 2).length;
  const cleanResolutions = settlements.filter((s) => s.winnerSide === 1 || s.winnerSide === 2).length;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-pv-muted">
          Oracle Analytics
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-pv-text sm:text-4xl">
          Mimir Stats
        </h1>
        <p className="mt-2 text-sm text-pv-muted">
          Live metrics from the Mimir contract on Arc Testnet — all settlements are on-chain and verifiable.
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 mb-8">
        {[
          { label: "Total Claims",      value: stats?.totalClaims ?? "—",      sub: "created on-chain" },
          { label: "Resolved",          value: stats?.totalResolved ?? "—",     sub: "by AI oracle" },
          { label: "Resolution Rate",   value: stats ? `${stats.resolutionRate}%` : "—", sub: "of all claims" },
          { label: "Avg Confidence",    value: `${avgConfidence}%`,             sub: "oracle certainty" },
          { label: "Open Claims",       value: stats?.openClaims ?? "—",        sub: "awaiting challengers" },
          { label: "Contract Balance",  value: stats ? `${stats.contractBalance.toFixed(2)} USDC` : "—", sub: "escrowed" },
          { label: "Oracle Balance",    value: stats ? `${stats.oracleBalance.toFixed(2)} USDC` : "—", sub: "auto-challenger" },
          { label: "Creator Win Rate",  value: cleanResolutions > 0 ? `${Math.round((creatorWins / cleanResolutions) * 100)}%` : "—", sub: `${creatorWins} creator / ${challengerWins} challenger` },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-2xl border border-white/[0.08] bg-pv-surface p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-pv-muted">{label}</div>
            <div className="mt-1 font-display text-2xl font-bold tracking-tight text-pv-text">{value}</div>
            <div className="mt-0.5 text-[11px] text-pv-muted">{sub}</div>
          </div>
        ))}
      </div>

      {/* Oracle info */}
      {stats && (
        <div className="mb-8 rounded-2xl border border-pv-emerald/[0.15] bg-pv-emerald/[0.04] p-4">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-pv-emerald">
            AI Oracle Agent
          </div>
          <div className="font-mono text-[12px] text-pv-text break-all">{stats.oracleAddress}</div>
          <p className="mt-2 text-[12px] text-pv-muted">
            The oracle evaluates expired claims using Claude AI, hashes evidence on-chain, and pays out winners automatically.
            With <code className="text-pv-emerald">AUTO_CHALLENGE=1</code>, it also stakes USDC on mispriced claims using Kelly Criterion position sizing.
          </p>
        </div>
      )}

      {/* Recent settlements */}
      <div>
        <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-pv-text">
          Recent Oracle Settlements
        </h2>
        {settlements.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-pv-surface p-8 text-center text-pv-muted text-sm">
            No settlements yet. Run <code className="text-pv-emerald">npm run seed</code> then <code className="text-pv-emerald">npm run oracle</code>.
          </div>
        ) : (
          <div className="space-y-3">
            {settlements.map((s) => {
              const side = SIDE_LABEL[s.winnerSide] ?? { label: "Unknown", color: "text-pv-muted" };
              return (
                <div key={s.txHash} className="rounded-2xl border border-white/[0.06] bg-pv-surface p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] text-pv-muted">Claim #{s.id}</span>
                        <span className={`text-[11px] font-bold ${side.color}`}>{side.label}</span>
                        <span className="text-[11px] text-pv-muted">{s.confidence}% confidence</span>
                      </div>
                      <p className="text-[13px] text-pv-text/80 line-clamp-2">{s.summary}</p>
                      {s.evidenceHash && s.evidenceHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px] font-mono uppercase tracking-wide text-pv-muted">Evidence hash:</span>
                          <span className="font-mono text-[10px] text-pv-emerald/70 truncate max-w-[200px]">{s.evidenceHash}</span>
                        </div>
                      )}
                    </div>
                    <a
                      href={`https://testnet.arcscan.app/tx/${s.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-pv-muted hover:text-pv-text transition-colors"
                    >
                      View tx ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Circle / Arc links */}
      <div className="mt-10 rounded-2xl border border-white/[0.06] bg-pv-surface p-6">
        <h3 className="mb-4 font-display text-lg font-bold tracking-tight text-pv-text">
          Get Testnet USDC
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              label: "Circle Faucet",
              href: "https://faucet.circle.com",
              desc: "Get free testnet USDC from Circle",
            },
            {
              label: "Arc Explorer",
              href: "https://testnet.arcscan.app",
              desc: "View transactions on ArcScan",
            },
            {
              label: "CCTP Bridge",
              href: "https://www.circle.com/en/cross-chain-transfer-protocol",
              desc: "Bridge USDC cross-chain to Arc",
            },
          ].map(({ label, href, desc }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-white/[0.08] p-3 hover:border-pv-emerald/30 hover:bg-pv-emerald/[0.04] transition-all"
            >
              <div className="text-[13px] font-semibold text-pv-text">{label} ↗</div>
              <div className="mt-0.5 text-[12px] text-pv-muted">{desc}</div>
            </a>
          ))}
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link href="/" className="text-sm text-pv-muted hover:text-pv-text transition-colors">
          ← Back to markets
        </Link>
      </div>
    </main>
  );
}
