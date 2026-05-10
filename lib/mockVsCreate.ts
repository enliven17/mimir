import type { VSData } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/constants";

/** Query `?demo=1` en `/vs/create` activa el flujo sin contrato. */
export const MOCK_CREATE_DEMO_QUERY = "demo";

/** VS de plantilla + merge con snapshot de sesión (no está en Explore). */
export const MOCK_CREATED_VS_ID = -4;

const STORAGE_KEY = "proven:create-mock-vs-v1";

/** Dirección mostrada en ticket / merge cuando no hay wallet en modo demo. */
export const MOCK_DEMO_CREATOR_ADDRESS =
  "0x1111111111111111111111111111111111111111";

/** Hashes ficticios (66 chars 0x + 64 hex); no son txs reales en explorer. */
export const MOCK_WALLET_TX_HASH = `0x${"d3".repeat(32)}`;
export const MOCK_CONSENSUS_TX_HASH = `0x${"c0".repeat(32)}`;

export type CreateMockSnapshotV1 = {
  version: 1;
  vsId: number;
  inviteKey: string;
  creator: string;
  vs: Pick<
    VSData,
    | "question"
    | "creator_position"
    | "opponent_position"
    | "resolution_url"
    | "stake_amount"
    | "deadline"
    | "created_at"
    | "category"
  > &
    Partial<
      Pick<
        VSData,
        | "market_type"
        | "odds_mode"
        | "max_challengers"
        | "is_private"
        | "settlement_rule"
        | "handicap_line"
        | "challenger_payout_bps"
      >
    >;
};

export function writeCreateMockSnapshot(payload: CreateMockSnapshotV1): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readCreateMockSnapshot(): CreateMockSnapshotV1 | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CreateMockSnapshotV1;
    if (
      parsed?.version !== 1 ||
      parsed.vsId !== MOCK_CREATED_VS_ID ||
      !parsed.vs ||
      typeof parsed.vs.question !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCreateMockSnapshot(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Plantilla mínima para `SAMPLE_VS`; el detalle fusiona con `readCreateMockSnapshot`. */
export function buildMockCreatedVsTemplate(): VSData {
  return {
    id: MOCK_CREATED_VS_ID,
    creator: ZERO_ADDRESS,
    opponent: ZERO_ADDRESS,
    question: "Demo challenge — complete el formulario en /vs/create?demo=1",
    creator_position: "—",
    opponent_position: "—",
    resolution_url: "https://example.com",
    stake_amount: 5,
    deadline: Math.floor(Date.now() / 1000) + 86400 * 7,
    state: "open",
    winner: ZERO_ADDRESS,
    resolution_summary: "",
    created_at: Math.floor(Date.now() / 1000),
    category: "custom",
    market_type: "binary",
    odds_mode: "pool",
    max_challengers: 1,
    is_private: false,
  };
}

export function mergeMockSnapshotIntoVs(
  base: VSData,
  snapshot: CreateMockSnapshotV1,
): VSData {
  const v = snapshot.vs;
  const isPrivate = Boolean(v.is_private ?? base.is_private);
  return {
    ...base,
    id: MOCK_CREATED_VS_ID,
    creator: snapshot.creator,
    question: v.question,
    creator_position: v.creator_position,
    opponent_position: v.opponent_position,
    counter_position: v.opponent_position,
    resolution_url: v.resolution_url,
    stake_amount: v.stake_amount,
    deadline: v.deadline,
    created_at: v.created_at,
    category: v.category,
    market_type: v.market_type ?? base.market_type,
    odds_mode: v.odds_mode ?? base.odds_mode,
    max_challengers: v.max_challengers ?? base.max_challengers,
    is_private: isPrivate,
    visibility: isPrivate ? "private" : "public",
    settlement_rule: v.settlement_rule ?? base.settlement_rule,
    handicap_line: v.handicap_line ?? base.handicap_line,
    challenger_payout_bps: v.challenger_payout_bps ?? base.challenger_payout_bps,
  };
}
