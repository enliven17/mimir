"use client";

import { DASHBOARD_CARD_SURFACE } from "@/lib/dashboardSurface";

const kpiSkeletonCardClass = `${DASHBOARD_CARD_SURFACE} pointer-events-none flex min-h-[5.75rem] flex-col items-center justify-center gap-3 p-5 sm:min-h-[6.25rem] sm:p-6`;

/**
 * Placeholders para las 4 KPI del dashboard — mismo grid y tamaño aproximado que las tarjetas
 * reales para evitar CLS en la carga inicial del snapshot.
 */
function KpiSkeletonTile() {
  return (
    <div className={kpiSkeletonCardClass} aria-hidden>
      <div className="h-9 w-[4.25rem] rounded-md bg-white/[0.1] motion-safe:animate-pulse motion-reduce:animate-none motion-reduce:opacity-90 sm:h-10 sm:w-24" />
      <div className="h-3 w-44 max-w-[85%] rounded bg-white/[0.07] motion-safe:animate-pulse motion-reduce:animate-none motion-reduce:opacity-90" />
    </div>
  );
}

export default function DashboardKpiSkeletonRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <KpiSkeletonTile key={i} />
      ))}
    </div>
  );
}
