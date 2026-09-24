/** Shown while the council's on-chain history is scanned on a cold cache. */
export default function CouncilLoading() {
  return (
    <section className="min-h-[60vh] flex items-center justify-center" aria-busy="true" aria-live="polite">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-pv-muted animate-pulse">
        Reading the council&apos;s bets from chain…
      </p>
    </section>
  );
}
