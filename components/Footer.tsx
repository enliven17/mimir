"use client";

export default function Footer() {
  return (
    <footer className="relative">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="border-x border-t border-pv-border/25 bg-pv-bg">
          {/* Main row */}
          <div className="flex flex-col gap-5 px-6 py-7 sm:px-10 sm:py-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-sm">
              <span className="font-display text-2xl font-bold tracking-tight text-pv-text">
                Mimir<span className="text-pv-emerald">.</span>
              </span>
              <p className="mt-2 font-mono text-[13px] leading-relaxed text-pv-muted">
                AI-settled claim markets on Arc. Stand behind your claim — Mimir
                settles it on-chain in USDC.
              </p>
            </div>
            {/* X / social */}
            <a
                href="https://x.com/Mimir_Markets"
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex shrink-0 items-center gap-2.5 border border-pv-border/25 px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-emerald"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="h-3.5 w-3.5 fill-current"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
                </svg>
                @Mimir_Markets
              </a>
          </div>

          {/* Bottom strip */}
          <div className="flex flex-col items-center justify-between gap-2 border-t border-pv-border/25 px-6 py-4 sm:flex-row sm:px-10">
            <span className="font-mono text-[11px] tracking-wide text-pv-muted/70">
              © {new Date().getFullYear()} Mimir Markets
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-pv-muted/70">
              Settled on-chain
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
