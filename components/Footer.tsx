"use client";

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-black/[0.06]">
      <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-pv-muted/85 sm:flex-row sm:px-6">
        <span className="font-display font-semibold tracking-tight text-pv-text/80">
          Mimir<span className="text-pv-emerald">.</span>
        </span>
        <span className="font-mono tracking-wide">
          AI-settled claim markets on Arc
        </span>
      </div>
    </footer>
  );
}
