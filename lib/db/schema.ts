import { bigint, integer, numeric, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

export const claims = pgTable("claims", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  creator: text("creator").notNull(),
  question: text("question"),
  creator_position: text("creator_position"),
  counter_position: text("counter_position"),
  resolution_url: text("resolution_url"),
  creator_stake: numeric("creator_stake", { mode: "number" }).notNull().default(0),
  total_challenger_stake: numeric("total_challenger_stake", { mode: "number" }).notNull().default(0),
  reserved_creator_liability: numeric("reserved_creator_liability", { mode: "number" }).notNull().default(0),
  deadline: bigint("deadline", { mode: "number" }).notNull().default(0),
  state: text("state").notNull().default("open"),
  winner_side: text("winner_side").notNull().default(""),
  resolution_summary: text("resolution_summary"),
  confidence: integer("confidence").notNull().default(0),
  category: text("category").notNull().default("custom"),
  parent_id: bigint("parent_id", { mode: "number" }).notNull().default(0),
  market_type: text("market_type").notNull().default("binary"),
  odds_mode: text("odds_mode").notNull().default("pool"),
  challenger_payout_bps: bigint("challenger_payout_bps", { mode: "number" }).notNull().default(0),
  handicap_line: text("handicap_line"),
  settlement_rule: text("settlement_rule"),
  max_challengers: bigint("max_challengers", { mode: "number" }).notNull().default(0),
  visibility: text("visibility").notNull().default("public"),
  challenger_count: bigint("challenger_count", { mode: "number" }).notNull().default(0),
  total_pot: numeric("total_pot", { mode: "number" }).notNull().default(0),
  first_challenger: text("first_challenger").notNull().default(""),
  first_indexed_at: bigint("first_indexed_at", { mode: "number" }).notNull().default(0),
  updated_at: bigint("updated_at", { mode: "number" }).notNull().default(0),
  is_final: integer("is_final").notNull().default(0),
});

export const challengers = pgTable(
  "challengers",
  {
    claim_id: bigint("claim_id", { mode: "number" }).notNull(),
    address: text("address").notNull(),
    stake: numeric("stake", { mode: "number" }).notNull().default(0),
    potential_payout: numeric("potential_payout", { mode: "number" }).notNull().default(0),
  },
  (table) => ({
    pk: primaryKey(table.claim_id, table.address),
  }),
);

export const syncMeta = pgTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const challengeOpportunities = pgTable(
  "challenge_opportunities",
  {
    locale: text("locale").notNull(),
    id: text("id").notNull(),
    source_url: text("source_url").notNull(),
    source_type: text("source_type").notNull(),
    source_summary: text("source_summary").notNull(),
    category: text("category").notNull(),
    claim_text: text("claim_text").notNull(),
    side_a: text("side_a").notNull(),
    side_b: text("side_b").notNull(),
    deadline_at: text("deadline_at").notNull(),
    timezone: text("timezone").notNull(),
    primary_resolution_source: text("primary_resolution_source").notNull(),
    settlement_rule: text("settlement_rule").notNull(),
    ambiguity_flags_json: text("ambiguity_flags_json").notNull().default("[]"),
    confidence_score: integer("confidence_score").notNull().default(0),
    claim_strength_score: integer("claim_strength_score").notNull().default(0),
    claim_strength_tier: text("claim_strength_tier").notNull().default("weak"),
    action: text("action").notNull().default("create"),
    existing_claim_id: bigint("existing_claim_id", { mode: "number" }),
    generated_at: bigint("generated_at", { mode: "number" }).notNull().default(0),
    expires_at: bigint("expires_at", { mode: "number" }).notNull().default(0),
  },
  (table) => ({
    pk: primaryKey(table.locale, table.id),
  }),
);

export const x402Payments = pgTable("x402_payments", {
  id: serial("id").primaryKey(),
  resource: text("resource").notNull(),
  price_usd: numeric("price_usd", { mode: "number" }).notNull().default(0),
  payer: text("payer"),
  seller: text("seller"),
  tx_id: text("tx_id"),
  at: bigint("at", { mode: "number" }).notNull().default(0),
});
