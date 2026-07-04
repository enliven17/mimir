import assert from "node:assert/strict";
import test from "node:test";

import {
  getVSSingleWinnerPayout,
  getVSUserWinAmount,
  getVSTotalPot,
  mapClaimToVS,
  type ClaimData,
} from "../../lib/contract";

const CREATOR = "0x00000000000000000000000000000000000000a1";
const CHALLENGER = "0x00000000000000000000000000000000000000b2";

function makeClaim(overrides: Partial<ClaimData> = {}): ClaimData {
  return {
    id: 7,
    creator: CREATOR,
    question: "Will BTC close above 100k?",
    creator_position: "Yes",
    counter_position: "No",
    resolution_url: "https://example.com/source",
    creator_stake: 5,
    total_challenger_stake: 3,
    reserved_creator_liability: 0,
    available_creator_liability: 5,
    deadline: 1_700_000_000,
    state: "resolved",
    winner_side: "creator",
    resolution_summary: "",
    confidence: 90,
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
    visibility: "public",
    is_private: false,
    challengers: [
      { address: CHALLENGER, stake: 3, potential_payout: 8 },
    ],
    first_challenger: CHALLENGER,
    challenger_addresses: [CHALLENGER],
    total_pot: 8,
    ...overrides,
  };
}

test("creator win pays the full pot", () => {
  const vs = mapClaimToVS(makeClaim());
  assert.equal(getVSSingleWinnerPayout(vs), getVSTotalPot(vs));
  assert.equal(getVSUserWinAmount(vs, CREATOR), 8);
  assert.equal(getVSUserWinAmount(vs, CHALLENGER), 0);
});

test("single challenger pool win pays the full pot", () => {
  const vs = mapClaimToVS(makeClaim({ winner_side: "challengers" }));
  assert.equal(getVSSingleWinnerPayout(vs), 8);
  assert.equal(getVSUserWinAmount(vs, CHALLENGER), 8);
  assert.equal(getVSUserWinAmount(vs, CREATOR), 0);
});

test("fixed-odds challenger win pays stake * bps / 10_000 (floored)", () => {
  const vs = mapClaimToVS(
    makeClaim({
      winner_side: "challengers",
      odds_mode: "fixed",
      challenger_payout_bps: 18_500,
      challengers: [{ address: CHALLENGER, stake: 3, potential_payout: NaN }],
    })
  );
  // 3 * 18500 / 10000 = 5.55 → floor = 5
  assert.equal(getVSSingleWinnerPayout(vs), 5);
  // user-level payout is unfloored
  assert.equal(getVSUserWinAmount(vs, CHALLENGER), 5.55);
});

test("multi-challenger win has no single-winner payout, but per-user pool share works", () => {
  const other = "0x00000000000000000000000000000000000000c3";
  const vs = mapClaimToVS(
    makeClaim({
      winner_side: "challengers",
      challenger_count: 2,
      total_challenger_stake: 4,
      total_pot: 9,
      challengers: [
        { address: CHALLENGER, stake: 3, potential_payout: NaN },
        { address: other, stake: 1, potential_payout: NaN },
      ],
      challenger_addresses: [CHALLENGER, other],
    })
  );
  assert.equal(getVSSingleWinnerPayout(vs), null);
  // stake + stake/totalChallengerStake * creatorStake = 3 + (3/4)*5 = 6.75
  assert.equal(getVSUserWinAmount(vs, CHALLENGER), 6.75);
  // 1 + (1/4)*5 = 2.25
  assert.equal(getVSUserWinAmount(vs, other), 2.25);
});

test("unresolved claim pays nothing", () => {
  const vs = mapClaimToVS(makeClaim({ state: "active", winner_side: "" }));
  assert.equal(getVSSingleWinnerPayout(vs), 0);
  assert.equal(getVSUserWinAmount(vs, CREATOR), 0);
});
