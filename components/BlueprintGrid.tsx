// Centered section title framed by full-bleed rules above AND below it
// (blueprint header band) plus column-width side borders so the vertical column
// lines stay continuous through the band. There are no separate fixed rails —
// every blueprint section draws its own borders, so each line is single.
export function BlueprintHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative border-x border-pv-border/25 py-5 text-center sm:py-6">
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-px w-screen -translate-x-1/2 bg-pv-border/25"
      />
      <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
        {children}
      </h2>
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 bottom-0 h-px w-screen -translate-x-1/2 bg-pv-border/25"
      />
    </div>
  );
}
