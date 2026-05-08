import type { CategoryId } from "@/lib/constants";

/**
 * Stake holdings mostrados en el dashboard (mock hasta conectar wallet / indexer).
 * Las claves de copy coinciden con `dashboard.holdings.items.<id>` en mensajes.
 */
export const DASHBOARD_STAKE_HOLDING_IDS = ["canelo", "colapinto", "alvarez"] as const;

export type DashboardStakeHoldingId = (typeof DASHBOARD_STAKE_HOLDING_IDS)[number];

export type DashboardHoldingStatus = "open" | "accepted" | "resolved";

export type DashboardHoldingVisibility = "public" | "private";

/** Tipos alineados con `vsDetail.marketTypes` (i18n). */
export type DashboardHoldingMarketType =
  | "binary"
  | "moneyline"
  | "spread"
  | "total"
  | "prop"
  | "custom";

/** Metadatos de mercado por fila (mock; con datos reales vendrán del VS). */
export const DASHBOARD_STAKE_HOLDING_META: Record<
  DashboardStakeHoldingId,
  {
    categoryId: CategoryId;
    status: DashboardHoldingStatus;
    /** Código visible tipo arena (`#xxxx-X`). */
    idCode: string;
    marketType: DashboardHoldingMarketType;
    oddsMode: "pool" | "fixed";
    /** Público o privado (duelo acotado). */
    visibility: DashboardHoldingVisibility;
    /** Participantes actuales en el pool / mercado. */
    participantCount: number;
    /**
     * Tope de plazas (p. ej. duelo 1v1 = 2). `null` = pool abierto sin tope en UI.
     */
    maxParticipants: number | null;
  }
> = {
  canelo: {
    categoryId: "sports",
    status: "accepted",
    idCode: "#0482-P",
    marketType: "total",
    oddsMode: "pool",
    visibility: "public",
    participantCount: 24,
    maxParticipants: null,
  },
  colapinto: {
    categoryId: "sports",
    status: "open",
    idCode: "#0611-F",
    marketType: "prop",
    oddsMode: "pool",
    visibility: "public",
    participantCount: 2,
    maxParticipants: 2,
  },
  alvarez: {
    categoryId: "sports",
    status: "accepted",
    idCode: "#0339-A",
    marketType: "prop",
    oddsMode: "fixed",
    visibility: "public",
    participantCount: 156,
    maxParticipants: null,
  },
};

/** Destino del CTA «ver detalles» por fila (sustituir por `/vs/:id` cuando haya datos reales). */
export const dashboardStakeHoldingDetailHref: Record<
  DashboardStakeHoldingId,
  string
> = {
  canelo: "/explorer",
  colapinto: "/explorer",
  alvarez: "/explorer",
};

/** Píldora del pie (LIVE / OPEN / CLOSED / Settled): coherente con visibilidad y cupo. */
export type DashboardFooterPoolPill = "live" | "open" | "closed" | "settled";

export function getDashboardHoldingFooterPoolPill(
  meta: (typeof DASHBOARD_STAKE_HOLDING_META)[DashboardStakeHoldingId]
): DashboardFooterPoolPill {
  if (meta.status === "resolved") return "settled";
  if (meta.status === "accepted") return "live";
  if (
    meta.status === "open" &&
    meta.visibility === "private" &&
    meta.maxParticipants != null &&
    meta.participantCount >= meta.maxParticipants
  ) {
    return "closed";
  }
  return "open";
}

/** Perfil de riesgo mock (suma ≈ 100 para UI). */
export const DASHBOARD_RISK_PROFILE_MOCK = [
  { key: "conservative", pct: 45 },
  { key: "moderate", pct: 34 },
  { key: "aggressive", pct: 21 },
] as const;
