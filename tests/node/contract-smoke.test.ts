import assert from "node:assert/strict";
import test from "node:test";

import {
  getVSTotalPot,
  isVSJoinable,
  isVSPrivate,
  mapClaimToVS,
  type ClaimData,
} from "../../lib/contract";

function makeClaim(overrides: Partial<ClaimData> = {}): ClaimData {
  return {
    id: 4,
    creator: "0x00000000000000000000000000000000000000a1",
    question: "Will BTC close above 100k?",
    creator_position: "Yes",
    counter_position: "No",
    resolution_url: "https://example.com/source",
    creator_stake: 5,
    total_challenger_stake: 3,
    reserved_creator_liability: 0,
    available_creator_liability: 5,
    deadline: 1_700_000_000,
    state: "active",
    winner_side: "",
    resolution_summary: "",
    confidence: 0,
    category: "crypto",
    parent_id: 0,
    challenger_count: 1,
    market_type: "binary",
    odds_mode: "pool",
    challenger_payout_bps: 0,
    handicap_line: "",
    settlement_rule: "",
    max_challengers: 3,
    created_at: 0,
    visibility: "private",
    is_private: true,
    challengers: [
      {
        address: "0x00000000000000000000000000000000000000b2",
        stake: 3,
        potential_payout: 8,
      },
    ],
    first_challenger: "0x00000000000000000000000000000000000000b2",
    challenger_addresses: ["0x00000000000000000000000000000000000000b2"],
    total_pot: 8,
    ...overrides,
  };
}

test("mapClaimToVS keeps compatibility fields for active private claims", () => {
  const vs = mapClaimToVS(makeClaim());

  assert.equal(vs.state, "accepted");
  assert.equal(vs.opponent, "0x00000000000000000000000000000000000000b2");
  assert.equal(vs.opponent_position, "No");
  assert.equal(vs.stake_amount, 5);
  assert.equal(isVSPrivate(vs), true);
  assert.equal(getVSTotalPot(vs), 8);
});

test("isVSJoinable blocks creator, existing challenger, and full pools", () => {
  const baseVS = mapClaimToVS(makeClaim());

  assert.equal(
    isVSJoinable(baseVS, "0x00000000000000000000000000000000000000a1"),
    false
  );
  assert.equal(
    isVSJoinable(baseVS, "0x00000000000000000000000000000000000000b2"),
    false
  );
  assert.equal(
    isVSJoinable(baseVS, "0x00000000000000000000000000000000000000c3"),
    true
  );

  const fullVS = mapClaimToVS(
    makeClaim({
      challenger_count: 3,
      max_challengers: 3,
      challenger_addresses: [
        "0x00000000000000000000000000000000000000b2",
        "0x00000000000000000000000000000000000000b3",
        "0x00000000000000000000000000000000000000b4",
      ],
    })
  );
  assert.equal(
    isVSJoinable(fullVS, "0x00000000000000000000000000000000000000c3"),
    false
  );
});

test("mapClaimToVS preserves fixed-odds winner information", () => {
  const vs = mapClaimToVS(
    makeClaim({
      state: "resolved",
      winner_side: "challengers",
      odds_mode: "fixed",
      challenger_payout_bps: 18000,
    })
  );

  assert.equal(vs.state, "resolved");
  assert.equal(vs.winner, "0x00000000000000000000000000000000000000b2");
  assert.equal(vs.odds_mode, "fixed");
  assert.equal(vs.challenger_payout_bps, 18000);
});
