import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import { getChain, vsPath, type ChainKey } from "@/lib/chains";
import { parseChainParam } from "@/lib/server/api-validation";
import { verifyClaim, type VerificationReport } from "@/lib/server/verify";

export const dynamic = "force-dynamic";

const SIDE_LABEL: Record<number, string> = {
  1: "Creator wins",
  2: "Challengers win",
  3: "Draw (refunded)",
  4: "Unresolvable (refunded)",
};

const CARD = "rounded-xl border border-pv-border/40 bg-pv-surface/60 p-4 sm:p-5";
const LABEL = "font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-pv-muted";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className={`${LABEL} mb-3`}>{title}</h2>
      {children}
    </section>
  );
}

function Verdict({ report }: { report: VerificationReport }) {
  const c = report.onChain!;
  if (!report.resolved) {
    return <p className="text-sm text-pv-muted">This claim has not been resolved yet. Its record appears here once the oracle settles it.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="font-display text-xl font-bold text-pv-text">{SIDE_LABEL[c.winnerSide] ?? "Unknown"}</p>
      <p className="text-sm text-pv-muted">Confidence {c.confidence}%</p>
      <p className="text-sm leading-relaxed text-pv-text/90">{c.summary}</p>
    </div>
  );
}

function MatchBadge({ report }: { report: VerificationReport }) {
  const hash = report.onChain?.evidenceHash;
  if (!report.resolved) return null;
  if (!hash) {
    return <p className="text-sm text-pv-muted">No evidence hash was committed for this claim (settled before audit bundles existed, or refunded by timeout).</p>;
  }
  if (!report.bundle) {
    return (
      <p className="rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-100/90">
        The committed hash has no stored bundle. It was settled before audit bundles existed, or the bundle could not be stored.
      </p>
    );
  }
  return report.matches ? (
    <p className="rounded-md border border-emerald-400/30 bg-emerald-400/[0.07] px-3 py-2 text-sm text-emerald-100">
      ✓ Verified: the bundle below hashes to the evidenceHash stored on chain. Nothing in it was changed after settlement.
    </p>
  ) : (
    <p className="rounded-md border border-pv-danger/40 bg-pv-danger/[0.08] px-3 py-2 text-sm text-pv-danger">
      ✗ Mismatch: the stored bundle does not hash to the on-chain evidenceHash. Do not trust it.
    </p>
  );
}

export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chain?: string }>;
}) {
  const { id } = await params;
  const claimId = Number(id);
  const chain = (parseChainParam((await searchParams).chain ?? null) ?? "arc") as ChainKey;
  const report = Number.isInteger(claimId) && claimId > 0
    ? await verifyClaim(chain, claimId).catch(() => null)
    : null;

  const b = report?.bundle;
  const rawHref = `/api/verify/${claimId}?chain=${chain}&raw=1`;

  return (
    <div className="pb-12">
      <BlueprintHeading>Verify a verdict</BlueprintHeading>
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-6 sm:px-6">
        {!report || !report.found ? (
          <p className="text-center text-sm text-pv-muted">Claim not found on {getChain(chain).name}.</p>
        ) : (
          <>
            <p className="text-center text-sm text-pv-muted">
              Claim #{claimId} on {getChain(chain).name} ·{" "}
              <Link href={vsPath(claimId, chain)} className="underline decoration-pv-emerald/60 underline-offset-2 hover:text-pv-text">
                open the market
              </Link>
            </p>

            <Section title="On-chain verdict">
              <Verdict report={report} />
            </Section>

            <MatchBadge report={report} />

            {report.onChain?.evidenceHash ? (
              <Section title="Commitment">
                <dl className="space-y-2 break-all font-mono text-xs text-pv-text/85">
                  <div><dt className={LABEL}>evidenceHash on chain</dt><dd>{report.onChain.evidenceHash}</dd></div>
                  {report.recomputedHash ? (
                    <div><dt className={LABEL}>keccak256(bundle) recomputed</dt><dd>{report.recomputedHash}</dd></div>
                  ) : null}
                </dl>
                {b ? (
                  <p className="mt-3 text-xs leading-relaxed text-pv-muted">
                    Check it yourself: <a href={rawHref} className="underline decoration-pv-emerald/60 underline-offset-2 hover:text-pv-text">download the bundle</a>{" "}
                    and hash the file with keccak256 (e.g. <code>cast keccak &quot;$(cat bundle.json)&quot;</code>). The result must equal the on-chain evidenceHash.
                  </p>
                ) : null}
              </Section>
            ) : null}

            {b ? (
              <>
                <Section title="How it was decided">
                  <ul className="space-y-1.5 text-sm text-pv-text/90">
                    <li><span className="text-pv-muted">Decided by:</span> {b.model ?? (b.council ? "council tally" : "unknown")}</li>
                    <li><span className="text-pv-muted">Decided at:</span> {new Date(b.decidedAt).toISOString()}</li>
                    {b.rawVerdict ? (
                      <li><span className="text-pv-muted">Raw verdict:</span> {b.rawVerdict.verdict} ({b.rawVerdict.confidence}%)</li>
                    ) : null}
                    <li><span className="text-pv-muted">Final verdict:</span> {b.finalVerdict.verdict} ({b.finalVerdict.confidence}%)</li>
                  </ul>
                  {b.adjustments.length > 0 ? (
                    <div className="mt-3">
                      <p className={LABEL}>Adjustments</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-pv-text/85">
                        {b.adjustments.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </Section>

                {b.resolver ? (
                  <Section title="Structured resolver">
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-pv-bg/60 p-3 font-mono text-xs text-pv-text/85">{JSON.stringify(b.resolver.spec, null, 2)}</pre>
                    <p className="mt-2 text-sm text-pv-text/90">{b.resolver.detail}</p>
                  </Section>
                ) : null}

                {b.prices ? (
                  <Section title={`${b.prices.symbol}/USD at the deadline (threshold $${b.prices.threshold.toLocaleString("en-US")})`}>
                    <ul className="space-y-1 font-mono text-xs text-pv-text/85">
                      {b.prices.readings.map((r) => (
                        <li key={r.source}>{r.source}: ${r.priceUsd.toLocaleString("en-US", { maximumFractionDigits: 6 })} · {new Date(r.at).toISOString()}</li>
                      ))}
                    </ul>
                  </Section>
                ) : null}

                {b.council ? (
                  <Section title="Council votes">
                    <ul className="grid gap-1 font-mono text-xs text-pv-text/85 sm:grid-cols-2">
                      {b.council.votes.map((v) => (
                        <li key={v.slug}>{v.slug}: {v.verdict} ({v.confidence}%)</li>
                      ))}
                    </ul>
                  </Section>
                ) : null}

                {b.evidence ? (
                  <Section title={`Evidence read (${b.evidence.fetcher})`}>
                    <p className="mb-2 break-all text-xs text-pv-muted">{b.claim.resolutionUrl}</p>
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-pv-bg/60 p-3 font-mono text-[11px] leading-relaxed text-pv-text/80">{b.evidence.text}</pre>
                  </Section>
                ) : null}

                <Section title="The claim as the oracle read it">
                  <p className="text-sm text-pv-text">{b.claim.question}</p>
                  <p className="mt-2 text-xs text-pv-muted">Creator: {b.claim.creatorPosition} · Challengers: {b.claim.counterPosition}</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-pv-muted">{b.claim.settlementRule}</p>
                </Section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
