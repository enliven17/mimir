/**
 * Superficies del dashboard — alineadas a `ArenaCard` en Explorer: panel gris `pv-surface`
 * frente al fondo `pv-bg`, borde `white/[0.12]`, hover como en Arena (`#242323` + borde emerald).
 *
 * Evitar fondos muy transparentes que se confundan con el fondo de página.
 */

/** Tarjeta estándar: filas de lista, contenedor de VS, KPI (paridad `ArenaCard`). */
export const DASHBOARD_CARD_SURFACE =
  "rounded-xl border border-white/[0.12] bg-pv-surface";

/** Hover para KPI y bloques planos interactivos (paridad `ArenaCard`). */
export const DASHBOARD_CARD_HOVER =
  "transition-[border-color,background-color] duration-200 hover:border-pv-emerald/30 hover:bg-[#242323]";

/** Panel con padding (filtros, perfil de riesgo, quick actions). */
export const DASHBOARD_PANEL_SURFACE = `${DASHBOARD_CARD_SURFACE} p-4 sm:p-5`;

/** Estados vacíos / sin coincidencias (mismo relleno gris, borde discontinuo). */
export const DASHBOARD_SURFACE_DASHED =
  "rounded-xl border border-dashed border-white/[0.12] bg-pv-surface";

/** Barra de resumen, "load more" (tono gris intermedio, misma familia cromática). */
export const DASHBOARD_SURFACE_MUTED =
  "rounded-xl border border-white/[0.1] bg-pv-surface2/35";

/** Placeholder de carga de filas. */
export const DASHBOARD_SKELETON_ROW =
  "rounded-xl border border-white/[0.12] bg-pv-surface2/50";

/** Celdas de stats dentro de filas (mismo patrón que `ArenaCard`). */
export const DASHBOARD_STAT_CELL_SURFACE =
  "rounded border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 sm:px-3.5 sm:py-3";
