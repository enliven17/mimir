import {
  type VSData,
  getVSUserCommittedStake,
} from "@/lib/contract";
import { isSampleVsIdForXmtp } from "@/lib/xmtp/vs-chat-eligibility";

/**
 * Dashboard UI — Fase 0 (decisiones de producto, en código mantenible)
 *
 * - KPI: banda de 4 stats (won / lost / win rate / total winnings), mismo patrón de tarjetas
 *   que la franja de stats de la home (`page.tsx`: borde suave, `LiveStat` lg, grid + gap).
 *   Carga inicial: `DashboardKpiSkeletonRow` reserva el mismo grid para evitar CLS hasta el snapshot.
 * - Superficies: tokens en `lib/dashboardSurface.ts` (paridad `ArenaCard`: `bg-pv-surface`,
 *   borde `white/[0.12]`, hover `#242323`) para filtros, lista, riesgo, vacíos y KPI; acentos
 *   semánticos (emerald / gold / red) solo donde aportan significado.
 * - Active Exposure: lista única basada en `filtered` (mismos filtros que la barra).
 * - Paginación: “Load more” en la lista de VS (no en la banda).
 * - Mocks Pereira/Canelo, Colapinto, Álvarez: solo si el usuario no tiene al menos
 *   un VS propio en `open` o `accepted` con id “real” (no sample Explore / negativos en SAMPLE_VS).
 *
 * Dashboard UI — Fase 1
 *
 * - Jerarquía: la banda de 4 KPI va **antes** del grid Active Exposure + sidebar (lectura rápida).
 * - Active Exposure: texto de contexto “mostrando X de Y” alineado con `filtered` y el paginado.
 * - Carga inicial: esqueleto en la lista (no vacío ni mocks demo hasta tener snapshot).
 * - Refresco: la lista puede atenuarse con `aria-busy` mientras se revalida el snapshot.
 *
 * Dashboard UI — Fase 2 (resultado + descubrimiento desde el dashboard)
 *
 * - Filas **resueltas o canceladas**: indicador de resultado para el viewer (ganó / perdió /
 *   cancelado / liquidado sin veredicto claro en datos) + copy breve en el panel expandido
 *   y CTA al detalle del VS para la explicación completa de liquidación.
 * - **Sin desafíos**: CTAs claros (crear + explorar) además del copy existente.
 * - **Quick actions**: acceso explícito a crear desafío junto a explorar; retiro sigue “pronto”.
 * - Refresco: la **columna lateral** se atenúa con la lista cuando hay snapshot en pantalla.
 *
 * Dashboard UI — Fase 3 (orientación + ergonomía)
 *
 * - **Resumen del conjunto filtrado**: conteos por estado (abierto / en vivo / cerrado) y
 *   total aproximado de GEN **en riesgo** (solo `open` + `accepted`) para la wallet,
 *   derivado de `getVSUserCommittedStake` (misma noción de apuesta que las filas).
 * - **Filtros sticky** bajo el header fijo al hacer scroll en la columna de exposición.
 * - **Ancla** `#dashboard-exposure` + `scroll-margin` para saltos sin quedar bajo el nav.
 * - **Movimiento reducido**: acordeón de filas y esqueleto respetan `prefers-reduced-motion`.
 *
 * Dashboard UI — Fase 4 (compartir estado + accesibilidad de filtros)
 *
 * - **URL y filtros**: pestaña (`tab`), categoría (`cat`), apuesta mínima (`min`) y búsqueda (`q`)
 *   se reflejan en la query con `history.replaceState` (mismo enfoque que Explore: sin
 *   `router.replace` que dispare re-fetch de RSC). Soporta atrás/adelante vía `popstate`.
 * - **Teclado en pestañas**: flechas izquierda/derecha e Inicio/Fin sobre el `tablist`.
 * - **Panel Advanced** y spinner de refresco respetan movimiento reducido.
 *
 * Dashboard UI — Fase 5 (lista + fiabilidad de datos)
 *
 * - **Orden de lista** fijo `newest` vía `applyExploreFilters` (sin UI ni `?sort=` en el dashboard).
 * - **Frescura del snapshot**: superficie breve junto al resumen (estado index + antigüedad relativa)
 *   cuando `getUserVSSnapshot` devuelve `cache`.
 * - **Error de carga**: mensaje accesible + reintento sin perder el último listado cargado con éxito.
 *
 * (Filtros rápidos tipo Explore y orden alternativo viven solo en Arena / Explorer, no en esta barra.)
 */

/** Filas VS mostradas antes del primer “Load more”. */
export const DASHBOARD_EXPOSURE_PAGE_SIZE = 5;

/** Filas añadidas en cada “Load more”. */
export const DASHBOARD_EXPOSURE_LOAD_MORE = 5;

/**
 * Muestra las filas demo de `DASHBOARD_STAKE_HOLDING_IDS` solo cuando no hay
 * exposición activa “real” (on-chain / no sample) en open o accepted.
 */
export function shouldShowDashboardStakeHoldingsMocks(duels: VSData[]): boolean {
  const hasRealActive = duels.some(
    (d) =>
      (d.state === "open" || d.state === "accepted") &&
      !isSampleVsIdForXmtp(d.id)
  );
  return !hasRealActive;
}

export type DashboardFilteredExposureSummary = {
  filteredTotal: number;
  openCount: number;
  liveCount: number;
  closedCount: number;
  /** Suma de apuestas del viewer en VS open + accepted (aprox. en pools multi-retador). */
  genAtRisk: number;
};

/**
 * Métricas agregadas sobre la misma lista que Active Exposure (post-filtros).
 */
export function summarizeDashboardFilteredExposure(
  filtered: VSData[],
  viewerAddress?: string | null
): DashboardFilteredExposureSummary {
  let openCount = 0;
  let liveCount = 0;
  let closedCount = 0;
  let genAtRisk = 0;

  for (const vs of filtered) {
    if (vs.state === "open") {
      openCount += 1;
      genAtRisk += getVSUserCommittedStake(vs, viewerAddress);
    } else if (vs.state === "accepted") {
      liveCount += 1;
      genAtRisk += getVSUserCommittedStake(vs, viewerAddress);
    } else if (vs.state === "resolved" || vs.state === "cancelled") {
      closedCount += 1;
    }
  }

  return {
    filteredTotal: filtered.length,
    openCount,
    liveCount,
    closedCount,
    genAtRisk,
  };
}
