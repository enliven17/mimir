import { Suspense } from "react";
import DashboardPageClient from "./DashboardPageClient";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardPageFallback />}>
      <DashboardPageClient />
    </Suspense>
  );
}

function DashboardPageFallback() {
  return (
    <div
      className="space-y-8 py-6 motion-reduce:animate-none"
      aria-busy
      aria-label="Loading dashboard"
    >
      <div className="animate-pulse space-y-4 motion-reduce:animate-none">
        <div className="h-10 w-48 rounded bg-pv-surface2 sm:h-12 sm:w-56" />
        <div className="h-4 max-w-md rounded bg-pv-surface2/80" />
      </div>
      <div className="h-28 animate-pulse rounded-2xl bg-pv-surface2/90 motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-lg bg-pv-surface2/80 motion-reduce:animate-none" />
      <div className="space-y-3">
        <div className="h-16 animate-pulse rounded-lg bg-pv-surface2/70 motion-reduce:animate-none" />
        <div className="h-16 animate-pulse rounded-lg bg-pv-surface2/70 motion-reduce:animate-none" />
        <div className="h-16 animate-pulse rounded-lg bg-pv-surface2/70 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
