import { Pool, neonConfig, type PoolConfig } from "@neondatabase/serverless";
import ws from "ws";

import type { ChallengeOpportunity } from "@/lib/claimDrafts";
import type { ClaimChallenger, ClaimData } from "@/lib/contract";
import type { ChainKey } from "@/lib/chains";

// Neon's @neondatabase/serverless uses WebSockets in Node — wire up the ws
// implementation. In edge/serverless runtimes that don't ship a global
// WebSocket, this is a no-op fallback (Vercel edge has its own native WS).
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
}

export interface ClaimRow {
  id: number;
  /** Claim ids restart per chain; (chain, id) is the identity. */
  chain: ChainKey;
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
  /** On-chain creation time (s). 0 on rows indexed before it was stored. */
  created_at: number;
  first_indexed_at: number;
  updated_at: number;
  is_final: number;
}

export interface ChallengerRow {
  chain: ChainKey;
  claim_id: number;
  address: string;
  stake: number;
  potential_payout: number;
}

/** A claim's identity across chains. */
export interface ClaimRef {
  chain: ChainKey;
  id: number;
}

export interface ClaimFilters {
  /** Ids on `chain` (Arc when unset). Use `refs` to span chains. */
  ids?: number[];
  refs?: ClaimRef[];
  chain?: ChainKey;
  creator?: string;
  categories?: string[];
  states?: string[];
  parentId?: number;
  visibility?: string;
  isFinal?: boolean;
  limit?: number;
  orderBy?: "id_desc" | "created_desc" | "updated_desc" | "deadline_asc" | "deadline_desc";
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

interface SqlStatement {
  sql:   string;
  args?: ReadonlyArray<unknown>;
}

/**
 * Postgres schema. BIGINT for any value that could exceed 2^31 (stakes, deadlines).
 * On-conflict syntax is identical to SQLite since Postgres 9.5.
 */
const SCHEMA_STATEMENTS: SqlStatement[] = [
  { sql: `CREATE TABLE IF NOT EXISTS claims (
    chain TEXT NOT NULL DEFAULT 'arc',
    id BIGINT NOT NULL,
    creator TEXT NOT NULL,
    question TEXT,
    creator_position TEXT,
    counter_position TEXT,
    resolution_url TEXT,
    creator_stake NUMERIC NOT NULL DEFAULT 0,
    total_challenger_stake NUMERIC NOT NULL DEFAULT 0,
    reserved_creator_liability NUMERIC NOT NULL DEFAULT 0,
    deadline BIGINT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    winner_side TEXT NOT NULL DEFAULT '',
    resolution_summary TEXT,
    confidence INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'custom',
    parent_id BIGINT NOT NULL DEFAULT 0,
    market_type TEXT NOT NULL DEFAULT 'binary',
    odds_mode TEXT NOT NULL DEFAULT 'pool',
    challenger_payout_bps BIGINT NOT NULL DEFAULT 0,
    handicap_line TEXT,
    settlement_rule TEXT,
    max_challengers BIGINT NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'public',
    challenger_count BIGINT NOT NULL DEFAULT 0,
    total_pot NUMERIC NOT NULL DEFAULT 0,
    first_challenger TEXT NOT NULL DEFAULT '',
    first_indexed_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    is_final INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chain, id)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_state ON claims(state)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_creator ON claims(creator)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_deadline ON claims(deadline)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_parent ON claims(parent_id)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_visibility ON claims(visibility)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_active ON claims(state, is_final)" },
  { sql: `CREATE TABLE IF NOT EXISTS challengers (
    chain TEXT NOT NULL DEFAULT 'arc',
    claim_id BIGINT NOT NULL,
    address TEXT NOT NULL,
    stake NUMERIC NOT NULL DEFAULT 0,
    potential_payout NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (chain, claim_id, address)
  )` },
  // ── Multichain migration ───────────────────────────────────────────────────
  // Indexes built before Base/Arbitrum hold Arc rows keyed by id alone. Tag
  // them 'arc' and widen the primary keys to (chain, id); every existing row
  // keeps its meaning. Guarded so it runs once and is a no-op afterwards.
  { sql: "ALTER TABLE claims ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'arc'" },
  { sql: "ALTER TABLE challengers ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'arc'" },
  { sql: `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'claims'::regclass AND i.indisprimary AND a.attname = 'chain'
    ) THEN
      ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_pkey;
      ALTER TABLE claims ADD PRIMARY KEY (chain, id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'challengers'::regclass AND i.indisprimary AND a.attname = 'chain'
    ) THEN
      ALTER TABLE challengers DROP CONSTRAINT IF EXISTS challengers_pkey;
      ALTER TABLE challengers ADD PRIMARY KEY (chain, claim_id, address);
    END IF;
  END $$` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_claims_chain ON claims(chain)" },
  { sql: "ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_at BIGINT NOT NULL DEFAULT 0" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challengers_address ON challengers(address)" },
  // Stakes/payouts are USDC floats (e.g. 5.53), not whole numbers — BIGINT
  // columns rejected every fractional write, silently dropping challenger
  // rows (upsertChallengers wraps delete+inserts in one transaction, so a
  // single fractional stake rolled the whole claim's challenger list back).
  // Migrate pre-existing deployments that still have the BIGINT columns.
  { sql: "ALTER TABLE claims ALTER COLUMN creator_stake TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN total_challenger_stake TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN reserved_creator_liability TYPE NUMERIC" },
  { sql: "ALTER TABLE claims ALTER COLUMN total_pot TYPE NUMERIC" },
  { sql: "ALTER TABLE challengers ALTER COLUMN stake TYPE NUMERIC" },
  { sql: "ALTER TABLE challengers ALTER COLUMN potential_payout TYPE NUMERIC" },
  { sql: `CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )` },
  { sql: `CREATE TABLE IF NOT EXISTS challenge_opportunities (
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
    existing_claim_id BIGINT,
    generated_at BIGINT NOT NULL DEFAULT 0,
    expires_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (locale, id)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_locale ON challenge_opportunities(locale)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_expires_at ON challenge_opportunities(expires_at)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_challenge_opportunities_action ON challenge_opportunities(action)" },
  { sql: `CREATE TABLE IF NOT EXISTS x402_payments (
    id BIGSERIAL PRIMARY KEY,
    resource TEXT NOT NULL,
    price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    payer TEXT,
    seller TEXT,
    tx_id TEXT,
    at BIGINT NOT NULL DEFAULT 0
  )` },
  { sql: "ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS seller TEXT" },
  { sql: "ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS payment_id TEXT" },
  // CAIP-2 network the nanopayment settled on. NULL on rows from before
  // multichain, which were all Arc.
  { sql: "ALTER TABLE x402_payments ADD COLUMN IF NOT EXISTS network TEXT" },
  // A settlement retried by the facilitator must not be counted twice. The index
  // is partial so rows predating the column (payment_id NULL) stay valid.
  { sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_x402_payments_payment_id
          ON x402_payments(payment_id) WHERE payment_id IS NOT NULL` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_x402_payments_at ON x402_payments(at DESC)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_x402_payments_resource ON x402_payments(resource)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_x402_payments_seller ON x402_payments(seller)" },
  // ── Copy trading ───────────────────────────────────────────────────────────
  // A permission is a signed intent with hard bounds; an execution row is the
  // audit trail, including the copies that were refused and why.
  { sql: `CREATE TABLE IF NOT EXISTS copy_permissions (
    id TEXT PRIMARY KEY,
    follower TEXT NOT NULL,
    signal_agent_id TEXT NOT NULL,
    execution_agent_id TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at BIGINT NOT NULL DEFAULT 0,
    policy_json TEXT NOT NULL DEFAULT '{}',
    signature TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    revoked_at BIGINT
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_copy_permissions_follower ON copy_permissions(follower)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_copy_permissions_signal ON copy_permissions(signal_agent_id)" },
  { sql: `CREATE TABLE IF NOT EXISTS copy_executions (
    id BIGSERIAL PRIMARY KEY,
    permission_id TEXT NOT NULL,
    claim_id BIGINT NOT NULL,
    executed BOOLEAN NOT NULL DEFAULT FALSE,
    skip_reason TEXT,
    stake_usdc NUMERIC NOT NULL DEFAULT 0,
    tx_hash TEXT,
    at BIGINT NOT NULL DEFAULT 0
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_copy_executions_permission ON copy_executions(permission_id, at DESC)" },
  { sql: "ALTER TABLE copy_executions ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'arc'" },

  // ── Baskets ────────────────────────────────────────────────────────────────
  // A basket holds nothing: these rows are a definition and a set of signed
  // intents, never a ledger of deposits.
  { sql: `CREATE TABLE IF NOT EXISTS baskets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    thesis TEXT NOT NULL DEFAULT '',
    creator_wallet TEXT NOT NULL,
    members_json TEXT NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL DEFAULT 0
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_baskets_creator ON baskets(creator_wallet)" },
  { sql: `CREATE TABLE IF NOT EXISTS basket_subscriptions (
    basket_id TEXT NOT NULL,
    follower TEXT NOT NULL,
    per_market_cap_usdc NUMERIC NOT NULL DEFAULT 0,
    signature TEXT NOT NULL DEFAULT '',
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (basket_id, follower)
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_basket_subscriptions_follower ON basket_subscriptions(follower)" },

  // ── Agent registry (BYOA) ──────────────────────────────────────────────────
  { sql: `CREATE TABLE IF NOT EXISTS agent_registry (
    agent_id TEXT PRIMARY KEY,
    owner_wallet TEXT NOT NULL,
    operator_wallet TEXT NOT NULL,
    payout_wallet TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    authority_level SMALLINT NOT NULL DEFAULT 0,
    capabilities TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    limits_json TEXT NOT NULL DEFAULT '{}',
    created_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    last_seen_at BIGINT
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_agent_registry_owner ON agent_registry(owner_wallet)" },
  { sql: "CREATE INDEX IF NOT EXISTS idx_agent_registry_operator ON agent_registry(operator_wallet)" },
  { sql: `CREATE TABLE IF NOT EXISTS agent_api_keys (
    key_hash TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    revoked_at BIGINT
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys(agent_id)" },
  // Single-use nonces. A replayed envelope is rejected on the primary key.
  { sql: `CREATE TABLE IF NOT EXISTS agent_api_nonces (
    nonce TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    at BIGINT NOT NULL DEFAULT 0
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_agent_api_nonces_at ON agent_api_nonces(at)" },
  // Stored responses make a retry with the same idempotency key safe.
  { sql: `CREATE TABLE IF NOT EXISTS agent_api_responses (
    idempotency_key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 200,
    response TEXT NOT NULL,
    at BIGINT NOT NULL DEFAULT 0
  )` },
  // Older builds stored issued API keys here in plaintext. They are redacted now.
  { sql: "DELETE FROM agent_api_responses WHERE action = 'issueKey' AND response LIKE '%\"key\":\"mk_%'" },
  { sql: `CREATE TABLE IF NOT EXISTS agent_request_audit (
    id BIGSERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL,
    ok BOOLEAN NOT NULL DEFAULT TRUE,
    reason TEXT,
    at BIGINT NOT NULL DEFAULT 0
  )` },
  { sql: "CREATE INDEX IF NOT EXISTS idx_agent_request_audit_agent_at ON agent_request_audit(agent_id, at DESC)" },
  // Fixed-window counters for public routes that spend LLM quota (lib/server/rate-limit.ts).
  { sql: `CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_key, window_start)
  )` },
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING",
    args: ["last_claim_count", "0"],
  },
  {
    sql: "INSERT INTO sync_meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO NOTHING",
    args: ["last_sync_at", "0"],
  },
];

declare global {
  // eslint-disable-next-line no-var
  var __mimirDbPool:  Pool | undefined;
  // eslint-disable-next-line no-var
  var __mimirDbReady: Promise<Pool> | undefined;
}

function isDbConfigured(): boolean {
  return Boolean((process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim());
}

function getDbConnectionString(): string {
  const url = (process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL)?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  return url;
}

function buildPool(): Pool {
  const cfg: PoolConfig = { connectionString: getDbConnectionString() };
  return new Pool(cfg);
}

/** Convert `?` placeholders to Postgres `$1, $2, ...` in source order. */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function execute(
  pool: Pool,
  stmt: SqlStatement,
): Promise<{ rows: Array<Record<string, unknown>> }> {
  const args = stmt.args ?? [];
  const sql = stmt.sql.includes("$") ? stmt.sql : toPg(stmt.sql);
  const result = await pool.query(sql, args as unknown[]);
  return { rows: result.rows as Array<Record<string, unknown>> };
}

async function ensureSchema(pool: Pool): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await execute(pool, stmt);
  }
}

async function batchWrite(pool: Pool, statements: SqlStatement[]): Promise<void> {
  if (statements.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of statements) {
      const sql = stmt.sql.includes("$") ? stmt.sql : toPg(stmt.sql);
      await client.query(sql, (stmt.args ?? []) as unknown[]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function getNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function getString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function getNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function getChainKey(value: unknown): ChainKey {
  return value === "base" || value === "arbitrum" ? value : "arc";
}

function normalizeClaimRow(row: Record<string, unknown>): ClaimRow {
  return {
    id: getNumber(row.id),
    chain: getChainKey(row.chain),
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
    created_at: getNumber(row.created_at),
    first_indexed_at: getNumber(row.first_indexed_at),
    updated_at: getNumber(row.updated_at),
    is_final: getNumber(row.is_final),
  };
}

function normalizeChallengerRow(row: Record<string, unknown>): ChallengerRow {
  return {
    chain: getChainKey(row.chain),
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
    chain: claim.chain ?? "arc",
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
    created_at: claim.created_at ?? 0,
  };
}

function buildClaimUpsertStatement(claim: ClaimData, timestamp: number): SqlStatement {
  const record = buildIndexedClaimRecord(claim);
  return {
    sql: `INSERT INTO claims (
      chain, id, creator, question, creator_position, counter_position, resolution_url,
      creator_stake, total_challenger_stake, reserved_creator_liability,
      deadline, state, winner_side, resolution_summary, confidence, category,
      parent_id, market_type, odds_mode, challenger_payout_bps, handicap_line,
      settlement_rule, max_challengers, visibility, challenger_count, total_pot,
      first_challenger, first_indexed_at, updated_at, is_final, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chain, id) DO UPDATE SET
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
        WHEN claims.first_indexed_at > 0 THEN claims.first_indexed_at
        ELSE excluded.first_indexed_at
      END,
      updated_at = excluded.updated_at,
      is_final = excluded.is_final,
      created_at = CASE
        WHEN excluded.created_at > 0 THEN excluded.created_at
        ELSE claims.created_at
      END`,
    args: [
      record.chain,
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
      record.created_at,
    ],
  };
}

function makeListPlaceholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

export function getPrivateClaimFields(): string[] {
  return [...PRIVATE_CONTENT_FIELDS];
}

export async function getDb(): Promise<Pool> {
  if (!isDbConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!globalThis.__mimirDbPool) {
    globalThis.__mimirDbPool = buildPool();
  }
  if (!globalThis.__mimirDbReady) {
    globalThis.__mimirDbReady = ensureSchema(globalThis.__mimirDbPool).then(
      () => globalThis.__mimirDbPool as Pool,
    );
  }
  return globalThis.__mimirDbReady;
}

/**
 * Run one parameterized statement and return its rows.
 *
 * `?` placeholders are converted to Postgres `$n` in source order, matching the
 * rest of this module. Exported so feature modules can own their own queries
 * instead of growing this file without bound.
 */
export async function query(
  sql: string,
  args: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const pool = await getDb();
  const { rows } = await execute(pool, { sql, args });
  return rows;
}

export async function upsertClaim(claim: ClaimData): Promise<void> {
  const pool = await getDb();
  await execute(pool, buildClaimUpsertStatement(claim, Date.now()));
}

export async function upsertClaimsBatch(claims: ClaimData[]): Promise<void> {
  if (claims.length === 0) return;
  const pool = await getDb();
  const now = Date.now();
  await batchWrite(pool, claims.map((claim) => buildClaimUpsertStatement(claim, now)));
}

export async function getClaimById(id: number, chain: ChainKey = "arc"): Promise<ClaimRow | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT * FROM claims WHERE chain = ? AND id = ? LIMIT 1",
    args: [chain, id],
  });
  const row = result.rows[0];
  return row ? normalizeClaimRow(row as Record<string, unknown>) : null;
}

export async function getClaimsByFilter(filters: ClaimFilters = {}): Promise<ClaimRow[]> {
  const pool = await getDb();
  const clauses: string[] = [];
  const args: Array<string | number> = [];

  if (filters.ids && filters.ids.length > 0) {
    clauses.push(`chain = ? AND id IN (${makeListPlaceholders(filters.ids)})`);
    args.push(filters.chain ?? "arc", ...filters.ids);
  } else if (filters.chain) {
    clauses.push("chain = ?");
    args.push(filters.chain);
  }
  if (filters.refs && filters.refs.length > 0) {
    clauses.push(`(chain, id) IN (${filters.refs.map(() => "(?, ?)").join(", ")})`);
    for (const ref of filters.refs) args.push(ref.chain, ref.id);
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
    case "created_desc":
      // Pre-multichain rows carry created_at 0 and are all older Arc claims.
      orderBy = "ORDER BY created_at DESC, id DESC";
      break;
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
  const result = await execute(pool, {
    sql:  `SELECT * FROM claims ${whereClause} ${orderBy}${limitClause}`,
    args,
  });
  return result.rows.map((row) => normalizeClaimRow(row as Record<string, unknown>));
}

export async function getOpenClaims(): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    states: ["open", "active"],
    visibility: "public",
    orderBy: "deadline_asc",
  });
}

export async function getRecentlyResolved(limit: number): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    states: ["resolved"],
    visibility: "public",
    orderBy: "updated_desc",
    limit,
  });
}

export async function getExpiringClaims(withinSeconds: number): Promise<ClaimRow[]> {
  const pool = await getDb();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = await execute(pool, {
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

export async function getClaimsByParent(parentId: number, chain: ChainKey = "arc"): Promise<ClaimRow[]> {
  return getClaimsByFilter({
    parentId,
    chain,
    orderBy: "id_desc",
  });
}

export async function getClaimFreshness(
  id: number,
  chain: ChainKey = "arc",
): Promise<{ updated_at: number; is_final: number } | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT updated_at, is_final FROM claims WHERE chain = ? AND id = ? LIMIT 1",
    args: [chain, id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    updated_at: getNumber((row as Record<string, unknown>).updated_at),
    is_final:   getNumber((row as Record<string, unknown>).is_final),
  };
}

export async function upsertChallengers(
  claimId: number,
  challengers: ClaimChallenger[],
  chain: ChainKey = "arc",
): Promise<void> {
  const pool = await getDb();
  const statements: SqlStatement[] = [
    {
      sql:  "DELETE FROM challengers WHERE chain = ? AND claim_id = ?",
      args: [chain, claimId],
    },
    ...challengers.map((challenger) => ({
      sql: `INSERT INTO challengers(chain, claim_id, address, stake, potential_payout)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chain, claim_id, address) DO UPDATE SET
          stake = excluded.stake,
          potential_payout = excluded.potential_payout`,
      args: [
        chain,
        claimId,
        challenger.address.toLowerCase(),
        challenger.stake,
        challenger.potential_payout,
      ],
    })),
  ];
  await batchWrite(pool, statements);
}

export async function getChallengersByClaimId(
  claimId: number,
  chain: ChainKey = "arc",
): Promise<ChallengerRow[]> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT * FROM challengers WHERE chain = ? AND claim_id = ? ORDER BY address ASC",
    args: [chain, claimId],
  });
  return result.rows.map((row) => normalizeChallengerRow(row as Record<string, unknown>));
}

/** Every claim `address` challenged, on any chain. */
export async function getClaimsByChallenger(address: string): Promise<ClaimRef[]> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT chain, claim_id FROM challengers WHERE address = ? ORDER BY claim_id DESC",
    args: [address],
  });
  return result.rows.map((row) => ({
    chain: getChainKey((row as Record<string, unknown>).chain),
    id: getNumber((row as Record<string, unknown>).claim_id),
  }));
}

export async function getSyncMeta(key: string): Promise<string | null> {
  const pool = await getDb();
  const result = await execute(pool, {
    sql:  "SELECT value FROM sync_meta WHERE key = ? LIMIT 1",
    args: [key],
  });
  const row = result.rows[0];
  return row ? getString((row as Record<string, unknown>).value) : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
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
}): SqlStatement {
  return {
    sql: `INSERT INTO challenge_opportunities (
      locale, id, source_url, source_type, source_summary, category, claim_text,
      side_a, side_b, deadline_at, timezone, primary_resolution_source,
      settlement_rule, ambiguity_flags_json, confidence_score, claim_strength_score,
      claim_strength_tier, action, existing_claim_id, generated_at, expires_at
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
}): Promise<void> {
  const pool = await getDb();
  const generatedAt = args.generatedAt ?? Date.now();
  const statements: SqlStatement[] = [
    {
      sql:  "DELETE FROM challenge_opportunities WHERE locale = ?",
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
  await batchWrite(pool, statements);
}

export async function pruneExpiredChallengeOpportunities(nowMs = Date.now()): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql:  "DELETE FROM challenge_opportunities WHERE expires_at <= ?",
    args: [nowMs],
  });
}

export async function getActiveChallengeOpportunities(args?: {
  locale?: string;
  limit?: number;
  nowMs?: number;
}): Promise<ChallengeOpportunityRow[]> {
  const pool = await getDb();
  const locale = args?.locale === "es" ? "es" : "en";
  const limit =
    typeof args?.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 6;
  const nowMs = args?.nowMs ?? Date.now();
  const result = await execute(pool, {
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
  return result.rows.map((row) => normalizeChallengeOpportunityRow(row as Record<string, unknown>));
}

// ── x402 nanopayment ledger ───────────────────────────────────────────────────
// Durable record of every settled pay-per-request. The on-chain Gateway balance
// is still the ultimate source of truth; this powers the /revenue dashboard and
// survives restarts (unlike the in-memory ring buffer).

export interface X402PaymentRow {
  resource: string;
  price_usd: number;
  payer: string | null;
  seller: string | null;
  tx_id: string | null;
  at: number;
  /** Facilitator settlement identifier; unique when present, used to dedupe retries. */
  payment_id?: string | null;
  /** CAIP-2 network. NULL rows predate multichain and settled on Arc. */
  network?: string | null;
}

export interface X402RevenueSummary {
  totalCalls: number;
  totalUsd: number;
  uniquePayers: number;
  uniqueSellers: number;
  byResource: Array<{ resource: string; calls: number; usd: number }>;
  bySeller: Array<{ seller: string; calls: number; usd: number }>;
  byNetwork: Array<{ network: string; calls: number; usd: number }>;
  recent: X402PaymentRow[];
}

export async function insertX402Payment(e: X402PaymentRow): Promise<void> {
  const pool = await getDb();
  await execute(pool, {
    sql: `INSERT INTO x402_payments(resource, price_usd, payer, seller, tx_id, at, payment_id, network)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING`,
    args: [e.resource, e.price_usd, e.payer, e.seller, e.tx_id, e.at, e.payment_id ?? null, e.network ?? null],
  });
}

export async function getX402RevenueSummary(limit = 25): Promise<X402RevenueSummary> {
  const pool = await getDb();
  const [totals, byResource, recent] = await Promise.all([
    execute(pool, {
      sql: `SELECT COUNT(*) AS calls, COALESCE(SUM(price_usd), 0) AS usd,
              COUNT(DISTINCT LOWER(payer)) FILTER (WHERE payer IS NOT NULL) AS payers,
              COUNT(DISTINCT LOWER(seller)) FILTER (WHERE seller IS NOT NULL) AS sellers
            FROM x402_payments`,
    }),
    execute(pool, {
      sql: `SELECT resource, COUNT(*) AS calls, COALESCE(SUM(price_usd), 0) AS usd
            FROM x402_payments GROUP BY resource ORDER BY usd DESC`,
    }),
    execute(pool, {
      sql: "SELECT resource, price_usd, payer, seller, tx_id, at, network FROM x402_payments ORDER BY at DESC, id DESC LIMIT ?",
      args: [limit],
    }),
  ]);
  const bySeller = await execute(pool, {
    sql: `SELECT seller, COUNT(*) AS calls, COALESCE(SUM(price_usd), 0) AS usd
          FROM x402_payments
          WHERE seller IS NOT NULL
          GROUP BY seller
          ORDER BY usd DESC`,
  });
  const byNetwork = await execute(pool, {
    sql: `SELECT COALESCE(network, 'eip155:5042002') AS network, COUNT(*) AS calls,
            COALESCE(SUM(price_usd), 0) AS usd
          FROM x402_payments
          GROUP BY COALESCE(network, 'eip155:5042002')
          ORDER BY usd DESC`,
  });
  const t = totals.rows[0] ?? {};
  return {
    totalCalls: getNumber(t.calls),
    totalUsd: Math.round(getNumber(t.usd) * 1e6) / 1e6,
    uniquePayers: getNumber(t.payers),
    uniqueSellers: getNumber(t.sellers),
    byResource: byResource.rows.map((r) => ({
      resource: getString(r.resource),
      calls: getNumber(r.calls),
      usd: Math.round(getNumber(r.usd) * 1e6) / 1e6,
    })),
    bySeller: bySeller.rows.map((r) => ({
      seller: getString(r.seller),
      calls: getNumber(r.calls),
      usd: Math.round(getNumber(r.usd) * 1e6) / 1e6,
    })),
    byNetwork: byNetwork.rows.map((r) => ({
      network: getString(r.network),
      calls: getNumber(r.calls),
      usd: Math.round(getNumber(r.usd) * 1e6) / 1e6,
    })),
    recent: recent.rows.map((r) => ({
      resource: getString(r.resource),
      price_usd: getNumber(r.price_usd),
      payer: getNullableString(r.payer),
      seller: getNullableString(r.seller),
      tx_id: getNullableString(r.tx_id),
      at: getNumber(r.at),
      network: getNullableString(r.network),
    })),
  };
}
