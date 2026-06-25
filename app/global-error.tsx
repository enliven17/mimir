"use client";

import { useEffect } from "react";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error("Global app error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-pv-bg text-pv-text">
        <main className="min-h-screen flex items-center justify-center px-6">
          <section className="w-full max-w-2xl rounded-3xl border border-white/[0.08] bg-pv-surface/70 p-8 sm:p-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <p className="text-xs uppercase tracking-[0.35em] text-pv-emerald/85 font-bold">
              Safe fallback
            </p>
            <h1 className="mt-4 font-display text-4xl sm:text-5xl font-bold tracking-tight">
              Something went wrong.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-pv-muted">
              The app hit a fatal route error, but you can retry without reloading the whole session.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={reset}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-pv-emerald text-pv-bg font-bold hover:brightness-110 transition-all focus-ring"
              >
                Try again
              </button>
              <a
                href="/"
                className="w-full sm:w-auto px-5 py-3 rounded-xl border border-white/[0.12] hover:border-white/[0.2] hover:bg-white/[0.04] transition-all focus-ring"
              >
                Reload home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
