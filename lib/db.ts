import { createClient, type Client, type InStatement } from "@libsql/client";

import type { ChallengeOpportunity } from "@/lib/claimDrafts";
import type { ClaimChallenger, ClaimData } from "@/lib/contract";

export interface ClaimRow {
  id: number;
  creator: string;
  question: string | null;
  creator_position: string | null;
  counter_position: string | null;
  resolution_url: string | null;
  creator_stake: number;
  total_challenger_stake: number;
  reserved_creator_liability: number;
  deadline: number;
  state: string;
  winner_side: string;
  resolution_summary: string | null;
  confidence: number;
  category: string;
  parent_id: number;
  market_type: string;
  odds_mode: string;
  challenger_payout_bps: number;
  handicap_line: string | null;
  settlement_rule: string | null;
  max_challengers: number;
  visibility: string;
  challenger_count: number;
  total_pot: number;
  first_challenger: string;
  first_indexed_at: number;
  updated_at: number;
  is_final: number;
}

export interface ChallengerRow {
  claim_id: number;
  address: string;
  stake: number;
  potential_payout: number;
}

export interface ClaimFilters {
  ids?: number[];
  creator?: string;
  categories?: string[];
  states?: string[];
  parentId?: number;
  visibility?: string;
  isFinal?: boolean;
  limit?: number;
  orderBy?: "id_desc" | "updated_desc" | "deadline_asc" | "deadline_desc";
}

export interface ChallengeOpportunityRow {
  locale: string;
  id: string;
  source_url: string;
  source_type: string;
  source_summary: string;
  category: string;
  claim_text: string;
  side_a: string;
  side_b: string;
  deadline_at: string;
  timezone: string;
  primary_resolution_source: string;
  settlement_rule: string;
  ambiguity_flags_json: string;
  confidence_score: number;
  claim_strength_score: number;
  claim_strength_tier: string;
  action: string;
  existing_claim_id: number | null;
  generated_at: number;
  expires_at: number;
}

type IndexedClaimRecord = Omit<
  ClaimRow,
  "first_indexed_at" | "updated_at" | "is_final"
>;

const PRIVATE_CONTENT_FIELDS = [
  "question",
  "creator_position",
  "counter_position",
  "resolution_url",
  "resolution_summary",
  "handicap_line",
  "settlement_rule",
] as const;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY,
    creator TEXT NOT NULL,
    question TEXT,
    creator_position TEXT,
    counter_position TEXT,
    resolution_url TEXT,
    creator_stake INTEGER NOT NULL DEFAULT 0,
    total_challenger_stake INTEGER NOT NULL DEFAULT 0,
    reserved_creator_liability INTEGER NOT NULL DEFAULT 0,
    deadline INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    winner_side TEXT NOT NULL DEFAULT '',
    resolution_summary TEXT,
    confidence INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'custom',
    parent_id INTEGER NOT NULL DEFAULT 0,
    market_type TEXT NOT NULL DEFAULT 'binary',
    odds_mode TEXT NOT NULL DEFAULT 'pool',
    challenger_payout_bps INTEGER NOT NULL DEFAULT 0,
    handicap_line TEXT,
    settlement_rule TEXT,
    max_challengers INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'public',
    challenger_count INTEGER NOT NULL DEFAULT 0,
    total_pot INTEGER NOT NULL DEFAULT 0,
    first_challenger TEXT NOT NULL DEFAULT '',
    first_indexed_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    is_final INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS idx_claims_state ON claims(state)",
  "CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category)",
  "CREATE INDEX IF NOT EXISTS idx_claims_creator ON claims(creator)",
  "CREATE INDEX IF NOT EXISTS idx_claims_deadline ON claims(deadline)",
  "CREATE INDEX IF NOT EXISTS idx_claims_parent ON claims(parent_id)",
  "CREATE INDEX IF NOT EXISTS idx_claims_visibility ON claims(visibility)",
  "CREATE INDEX IF NOT EXISTS idx_claims_active ON claims(state, is_final)",
  `CREATE TABLE IF NOT EXISTS challengers (
    claim_id INTEGER NOT NULL,
    address TEXT NOT NULL,
    stake INTEGER NOT NULL DEFAULT 0,
    potential_payout INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (claim_id, address)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_challengers_address ON challengers(address)",
  `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS challenge_opportunities (
    locale TEXT NOT NULL,
    id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_summary TEXT NOT NULL,
    category TEXT NOT NULL,
    claim_text TEXT NOT NULL,
    side_a TEXT NOT NULL,
    side_b TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    primary_resolution_source TEXT NOT NULL,
    settlement_rule TEXT NOT NULL,
    ambiguity_flags_json TEXT NOT NULL DEFAULT '[]',
    confidence_score INTEGER NOT NULL DEFAULT 0,
    claim_strength_score INTEGER NOT NULL DEFAULT 0,
    claim_strength_tier TEXT NOT NULL DEFAULT 'weak',
    action TEXT NOT NULL DEFAULT 'create',
    existing_claim_id INTEGER,
    generated_at INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (locale, id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_locale ON challenge_opportunities(locale)",
  "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_expires_at ON challenge_opportunities(expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_action ON challenge_opportunities(action)",
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
    args: ["last_claim_count", "0"],
  },
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
    args: ["last_sync_at", "0"],
  },
] satisfies Array<string | InStatement>;

declare global {
  var __provenDbClient: Client | undefined;
  var __provenDbReady: Promise<Client> | undefined;
}

function isDbConfigured() {
  return Boolean(process.env.TURSO_DATABASE_URL?.trim());
}

function getDbConfig() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Turso database is not configured");
  }

  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  return authToken ? { url, authToken, intMode: "number" as const } : { url, intMode: "number" as const };
}

async function ensureSchema(client: Client) {
  await client.migrate(SCHEMA_STATEMENTS);
}

function getNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.length > 0) {
    return Number(value);
  }
  return 0;
}

function getString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function getNullableString(value: unknown) {
  if (value == null) {
    return null;
  }
  return String(value);
}

function normalizeClaimRow(row: Record<string, unknown>): ClaimRow {
  return {
    id: getNumber(row.id),
    creator: getString(row.creator),
    question: getNullableString(row.question),
    creator_position: getNullableString(row.creator_position),
    counter_position: getNullableString(row.counter_position),
    resolution_url: getNullableString(row.resolution_url),
    creator_stake: getNumber(row.creator_stake),
    total_challenger_stake: getNumber(row.total_challenger_stake),
    reserved_creator_liability: getNumber(row.reserved_creator_liability),
    deadline: getNumber(row.deadline),
    state: getString(row.state),
    winner_side: getString(row.winner_side),
    resolution_summary: getNullableString(row.resolution_summary),
    confidence: getNumber(row.confidence),
    category: getString(row.category),
    parent_id: getNumber(row.parent_id),
    market_type: getString(row.market_type),
    odds_mode: getString(row.odds_mode),
    challenger_payout_bps: getNumber(row.challenger_payout_bps),
    handicap_line: getNullableString(row.handicap_line),
    settlement_rule: getNullableString(row.settlement_rule),
    max_challengers: getNumber(row.max_challengers),
    visibility: getString(row.visibility),
    challenger_count: getNumber(row.challenger_count),
    total_pot: getNumber(row.total_pot),
    first_challenger: getString(row.first_challenger),
    first_indexed_at: getNumber(row.first_indexed_at),
    updated_at: getNumber(row.updated_at),
    is_final: getNumber(row.is_final),
  };
}

function normalizeChallengerRow(row: Record<string, unknown>): ChallengerRow {
  return {
    claim_id: getNumber(row.claim_id),
    address: getString(row.address),
    stake: getNumber(row.stake),
    potential_payout: getNumber(row.potential_payout),
  };
}

function normalizeChallengeOpportunityRow(
  row: Record<string, unknown>
): ChallengeOpportunityRow {
  return {
    locale: getString(row.locale),
    id: getString(row.id),
    source_url: getString(row.source_url),
    source_type: getString(row.source_type),
    source_summary: getString(row.source_summary),
    category: getString(row.category),
    claim_text: getString(row.claim_text),
    side_a: getString(row.side_a),
    side_b: getString(row.side_b),
    deadline_at: getString(row.deadline_at),
    timezone: getString(row.timezone),
    primary_resolution_source: getString(row.primary_resolution_source),
    settlement_rule: getString(row.settlement_rule),
    ambiguity_flags_json: getString(row.ambiguity_flags_json),
    confidence_score: getNumber(row.confidence_score),
    claim_strength_score: getNumber(row.claim_strength_score),
    claim_strength_tier: getString(row.claim_strength_tier),
    action: getString(row.action),
    existing_claim_id:
      row.existing_claim_id == null ? null : getNumber(row.existing_claim_id),
    generated_at: getNumber(row.generated_at),
    expires_at: getNumber(row.expires_at),
  };
}

function buildIndexedClaimRecord(claim: ClaimData): IndexedClaimRecord {
  const visibility = claim.visibility ?? (claim.is_private ? "private" : "public");
  const isPrivate = visibility === "private" || Boolean(claim.is_private);

  const content: Record<(typeof PRIVATE_CONTENT_FIELDS)[number], string | null> = {
    question: claim.question,
    creator_position: claim.creator_position,
    counter_position: claim.counter_position,
    resolution_url: claim.resolution_url,
    resolution_summary: claim.resolution_summary,
    handicap_line: claim.handicap_line,
    settlement_rule: claim.settlement_rule,
  };

  if (isPrivate) {
    for (const field of PRIVATE_CONTENT_FIELDS) {
      content[field] = null;
    }
  }

  return {
    id: claim.id,
    creator: claim.creator.toLowerCase(),
    question: content.question,
    creator_position: content.creator_position,
    counter_position: content.counter_position,
    resolution_url: content.resolution_url,
    creator_stake: claim.creator_stake,
    total_challenger_stake: claim.total_challenger_stake,
    reserved_creator_liability: claim.reserved_creator_liability,
    deadline: claim.deadline,
    state: claim.state,
    winner_side: claim.winner_side,
    resolution_summary: content.resolution_summary,
    confidence: claim.confidence,
    category: claim.category,
    parent_id: claim.parent_id,
    market_type: claim.market_type,
    odds_mode: claim.odds_mode,
    challenger_payout_bps: claim.challenger_payout_bps,
    handicap_line: content.handicap_line,
    settlement_rule: content.settlement_rule,
    max_challengers: claim.max_challengers,
    visibility,
    challenger_count: claim.challenger_count,
    total_pot: claim.total_pot,
    first_challenger:
      (claim.first_challenger ?? claim.challenger_addresses?.[0] ?? "").toLowerCase(),
  };
}

function buildClaimUpsertStatement(claim: ClaimData, timestamp: number): InStatement {
  const record = buildIndexedClaimRecord(claim);

  return {
    sql: `INSERT INTO claims (
      id,
      creator,
      question,
      creator_position,
      counter_position,
      resolution_url,
      creator_stake,
      total_challenger_stake,
      reserved_creator_liability,
      deadline,
      state,
      winner_side,
      resolution_summary,
      confidence,
      category,
      parent_id,
      market_type,
      odds_mode,
      challenger_payout_bps,
      handicap_line,
      settlement_rule,
      max_challengers,
      visibility,
      challenger_count,
      total_pot,
      first_challenger,
      first_indexed_at,
      updated_at,
      is_final
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      creator = excluded.creator,
      question = excluded.question,
      creator_position = excluded.creator_position,
      counter_position = excluded.counter_position,
      resolution_url = excluded.resolution_url,
      creator_stake = excluded.creator_stake,
      total_challenger_stake = excluded.total_challenger_stake,
      reserved_creator_liability = excluded.reserved_creator_liability,
      deadline = excluded.deadline,
      state = excluded.state,
      winner_side = excluded.winner_side,
      resolution_summary = excluded.resolution_summary,
      confidence = excluded.confidence,
      category = excluded.category,
      parent_id = excluded.parent_id,
      market_type = excluded.market_type,
      odds_mode = excluded.odds_mode,
      challenger_payout_bps = excluded.challenger_payout_bps,
      handicap_line = excluded.handicap_line,
      settlement_rule = excluded.settlement_rule,
      max_challengers = excluded.max_challengers,
      visibility = excluded.visibility,
      challenger_count = excluded.challenger_count,
      total_pot = excluded.total_pot,
      first_challenger = excluded.first_challenger,
      first_indexed_at = CASE
        WHEN first_indexed_at > 0 THEN first_indexed_at
        ELSE excluded.first_indexed_at
      END,
      updated_at = excluded.updated_at,
      is_final = excluded.is_final`,
    args: [
      record.id,
      record.creator,
      record.question,
      record.creator_position,
      record.counter_position,
      record.resolution_url,
      record.creator_stake,
      record.total_challenger_stake,
      record.reserved_creator_liability,
      record.deadline,
      record.state,
      record.winner_side,
      record.resolution_summary,
      record.confidence,
      record.category,
      record.parent_id,
      record.market_type,
      record.odds_mode,
      record.challenger_payout_bps,
      record.handicap_line,
      record.settlement_rule,
      record.max_challengers,
      record.visibility,
      record.challenger_count,
      record.total_pot,
      record.first_challenger,
      timestamp,
      timestamp,
      record.state === "resolved" || record.state === "cancelled" ? 1 : 0,
    ],
  };
}

function makeListPlaceholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

export function getPrivateClaimFields() {
  return [...PRIVATE_CONTENT_FIELDS];
}

export async function getDb() {
  if (!isDbConfigured()) {
    throw new Error("Turso database is not configured");
  }

  if (!globalThis.__provenDbClient) {
    globalThis.__provenDbClient = createClient(getDbConfig());
  }

  if (!globalThis.__provenDbReady) {
    globalThis.__provenDbReady = ensureSchema(globalThis.__provenDbClient).then(
      () => globalThis.__provenDbClient as Client
    );
  }

  return globalThis.__provenDbReady;
}

export async function upsertClaim(claim: ClaimData) {
  const db = await getDb();
  await db.execute(buildClaimUpsertStatement(claim, Date.now()));
}

export async function upsertClaimsBatch(claims: ClaimData[]) {
  if (claims.length === 0) {
    return;
  }

  const db = await getDb();
  const now = Date.now();
  await db.batch(claims.map((claim) => buildClaimUpsertStatement(claim, now)), "write");
}

export async function getClaimById(id: number) {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT * FROM claims WHERE id = ? LIMIT 1",
    args: [id],
  });

  const row = result.rows[0];
  return row ? normalizeClaimRow(row as Record<string, unknown>) : null;
}

export async function getClaimsByFilter(filters: ClaimFilters = {}) {
  const db = await getDb();
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filters.ids && filters.ids.length > 0) {
    clauses.push(`id IN (${makeListPlaceholders(filters.ids)})`);
    args.push(...filters.ids);
  }

  if (filters.creator) {
    clauses.push("creator = ?");
    args.push(filters.creator);
  }

  if (filters.categories && filters.categories.length > 0) {
    clauses.push(`category IN (${makeListPlaceholders(filters.categories)})`);
    args.push(...filters.categories);
  }

  if (filters.states && filters.states.length > 0) {
    clauses.push(`state IN (${makeListPlaceholders(filters.states)})`);
    args.push(...filters.states);
  }

  if (typeof filters.parentId === "number") {
    clauses.push("parent_id = ?");
    args.push(filters.parentId);
  }

  if (filters.visibility) {
    clauses.push("visibility = ?");
    args.push(filters.visibility);
  }

  if (typeof filters.isFinal === "boolean") {
    clauses.push("is_final = ?");
    args.push(filters.isFinal ? 1 : 0);
  }

  let orderBy = "ORDER BY id DESC";
  switch (filters.orderBy) {
    case "updated_desc":
      orderBy = "ORDER BY updated_at DESC, id DESC";
      break;
    case "deadline_asc":
      orderBy = "ORDER BY deadline ASC, id DESC";
      break;
    case "deadline_desc":
      orderBy = "ORDER BY deadline DESC, id DESC";
      break;
    case "id_desc":
    default:
      orderBy = "ORDER BY id DESC";
      break;
  }

  const limitClause =
    typeof filters.limit === "number" && filters.limit > 0 ? " LIMIT ?" : "";
  if (limitClause) {
    args.push(filters.limit as number);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await db.execute({
    sql: `SELECT * FROM claims ${whereClause} ${orderBy}${limitClause}`,
    args,
  });

  return result.rows.map((row) => normalizeClaimRow(row as Record<string, unknown>));
}

export async function getOpenClaims() {
  return getClaimsByFilter({
    states: ["open", "active"],
    visibility: "public",
    orderBy: "deadline_asc",
  });
}

export async function getRecentlyResolved(limit: number) {
  return getClaimsByFilter({
    states: ["resolved"],
    visibility: "public",
    orderBy: "updated_desc",
    limit,
  });
}

export async function getExpiringClaims(withinSeconds: number) {
  const db = await getDb();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = await db.execute({
    sql: `SELECT * FROM claims
      WHERE visibility = ?
        AND is_final = 0
        AND state IN (?, ?)
        AND deadline >= ?
        AND deadline <= ?
      ORDER BY deadline ASC, id DESC`,
    args: ["public", "open", "active", nowSeconds, nowSeconds + withinSeconds],
  });

  return result.rows.map((row) => normalizeClaimRow(row as Record<string, unknown>));
}

export async function getClaimsByParent(parentId: number) {
  return getClaimsByFilter({
    parentId,
    orderBy: "id_desc",
  });
}

export async function getClaimFreshness(id: number) {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT updated_at, is_final FROM claims WHERE id = ? LIMIT 1",
    args: [id],
  });

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    updated_at: getNumber((row as Record<string, unknown>).updated_at),
    is_final: getNumber((row as Record<string, unknown>).is_final),
  };
}

export async function upsertChallengers(
  claimId: number,
  challengers: ClaimChallenger[]
) {
  const db = await getDb();
  const statements: InStatement[] = [
    {
      sql: "DELETE FROM challengers WHERE claim_id = ?",
      args: [claimId],
    },
    ...challengers.map((challenger) => ({
      sql: `INSERT INTO challengers(claim_id, address, stake, potential_payout)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(claim_id, address) DO UPDATE SET
          stake = excluded.stake,
          potential_payout = excluded.potential_payout`,
      args: [
        claimId,
        challenger.address.toLowerCase(),
        challenger.stake,
        challenger.potential_payout,
      ],
    })),
  ];

  await db.batch(statements, "write");
}

export async function getChallengersByClaimId(claimId: number) {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT * FROM challengers WHERE claim_id = ? ORDER BY address ASC",
    args: [claimId],
  });

  return result.rows.map((row) =>
    normalizeChallengerRow(row as Record<string, unknown>)
  );
}

export async function getClaimsByChallenger(address: string) {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT claim_id FROM challengers WHERE address = ? ORDER BY claim_id DESC",
    args: [address],
  });

  return result.rows.map((row) =>
    getNumber((row as Record<string, unknown>).claim_id)
  );
}

export async function getSyncMeta(key: string) {
  const db = await getDb();
  const result = await db.execute({
    sql: "SELECT value FROM sync_meta WHERE key = ? LIMIT 1",
    args: [key],
  });

  const row = result.rows[0];
  return row ? getString((row as Record<string, unknown>).value) : null;
}

export async function setSyncMeta(key: string, value: string) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO sync_meta(key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

function buildChallengeOpportunityInsertStatement(args: {
  locale: string;
  opportunity: ChallengeOpportunity;
  generatedAt: number;
  expiresAt: number;
}): InStatement {
  return {
    sql: `INSERT INTO challenge_opportunities (
      locale,
      id,
      source_url,
      source_type,
      source_summary,
      category,
      claim_text,
      side_a,
      side_b,
      deadline_at,
      timezone,
      primary_resolution_source,
      settlement_rule,
      ambiguity_flags_json,
      confidence_score,
      claim_strength_score,
      claim_strength_tier,
      action,
      existing_claim_id,
      generated_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(locale, id) DO UPDATE SET
      source_url = excluded.source_url,
      source_type = excluded.source_type,
      source_summary = excluded.source_summary,
      category = excluded.category,
      claim_text = excluded.claim_text,
      side_a = excluded.side_a,
      side_b = excluded.side_b,
      deadline_at = excluded.deadline_at,
      timezone = excluded.timezone,
      primary_resolution_source = excluded.primary_resolution_source,
      settlement_rule = excluded.settlement_rule,
      ambiguity_flags_json = excluded.ambiguity_flags_json,
      confidence_score = excluded.confidence_score,
      claim_strength_score = excluded.claim_strength_score,
      claim_strength_tier = excluded.claim_strength_tier,
      action = excluded.action,
      existing_claim_id = excluded.existing_claim_id,
      generated_at = excluded.generated_at,
      expires_at = excluded.expires_at`,
    args: [
      args.locale,
      args.opportunity.id,
      args.opportunity.sourceUrl,
      args.opportunity.sourceType,
      args.opportunity.sourceSummary,
      args.opportunity.candidate.category,
      args.opportunity.candidate.claimText,
      args.opportunity.candidate.sideA,
      args.opportunity.candidate.sideB,
      args.opportunity.candidate.deadlineAt,
      args.opportunity.candidate.timezone,
      args.opportunity.candidate.primaryResolutionSource,
      args.opportunity.candidate.settlementRule,
      JSON.stringify(args.opportunity.candidate.ambiguityFlags ?? []),
      args.opportunity.candidate.confidenceScore,
      args.opportunity.claimStrengthScore,
      args.opportunity.claimStrengthTier,
      args.opportunity.action,
      args.opportunity.existingClaimId ?? null,
      args.generatedAt,
      args.expiresAt,
    ],
  };
}

export async function replaceChallengeOpportunities(args: {
  locale: string;
  opportunities: Array<ChallengeOpportunity & { expiresAt: number }>;
  generatedAt?: number;
}) {
  const db = await getDb();
  const generatedAt = args.generatedAt ?? Date.now();
  const statements: InStatement[] = [
    {
      sql: "DELETE FROM challenge_opportunities WHERE locale = ?",
      args: [args.locale],
    },
    ...args.opportunities.map((opportunity) =>
      buildChallengeOpportunityInsertStatement({
        locale: args.locale,
        opportunity,
        generatedAt,
        expiresAt: opportunity.expiresAt,
      })
    ),
  ];

  await db.batch(statements, "write");
}

export async function pruneExpiredChallengeOpportunities(nowMs = Date.now()) {
  const db = await getDb();
  await db.execute({
    sql: "DELETE FROM challenge_opportunities WHERE expires_at <= ?",
    args: [nowMs],
  });
}

export async function getActiveChallengeOpportunities(args?: {
  locale?: string;
  limit?: number;
  nowMs?: number;
}) {
  const db = await getDb();
  const locale = args?.locale === "es" ? "es" : "en";
  const limit =
    typeof args?.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 6;
  const nowMs = args?.nowMs ?? Date.now();

  const result = await db.execute({
    sql: `SELECT * FROM challenge_opportunities
      WHERE locale = ?
        AND expires_at > ?
      ORDER BY
        CASE action WHEN 'challenge' THEN 0 ELSE 1 END ASC,
        claim_strength_score DESC,
        confidence_score DESC,
        generated_at DESC
      LIMIT ?`,
    args: [locale, nowMs, limit],
  });

  return result.rows.map((row) =>
    normalizeChallengeOpportunityRow(row as Record<string, unknown>)
  );
}
