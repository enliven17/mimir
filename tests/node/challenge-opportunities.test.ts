import assert from "node:assert/strict";
import test from "node:test";

import type { SourceClaimDraftCandidate } from "../../lib/claimDrafts";
import type { VSData } from "../../lib/contract";
import { findExistingOpportunityClaim } from "../../lib/server/challenge-opportunities";

const BASE_CANDIDATE: SourceClaimDraftCandidate = {
  category: "crypto",
  claimText: "Will BTC close above $120,000 before April 30, 2026?",
  sideA: "BTC closes above $120,000 before April 30, 2026",
  sideB: "BTC does not close above $120,000 before April 30, 2026",
  deadlineAt: "2026-04-30T23:00:00.000Z",
  timezone: "UTC",
  primaryResolutionSource: "https://www.coingecko.com/en/coins/bitcoin",
  settlementRule:
    "Resolve this using the visible spot price on the linked source at the deadline time. If BTC is above the threshold, Side A wins.",
  ambiguityFlags: [],
  confidenceScore: 88,
};

const BASE_VS: VSData = {
  id: 42,
  creator: "0x1111111111111111111111111111111111111111",
  opponent: "0x0000000000000000000000000000000000000000",
  question: "Will BTC close above $120,000 before April 30, 2026?",
  creator_position: "BTC closes above $120,000 before April 30, 2026",
  opponent_position: "BTC does not close above $120,000 before April 30, 2026",
  resolution_url: "https://www.coingecko.com/en/coins/bitcoin",
  stake_amount: 5,
  deadline: 1777590000,
  state: "open",
  winner: "0x0000000000000000000000000000000000000000",
  resolution_summary: "",
  created_at: 1775000000,
  category: "crypto",
};

test("findExistingOpportunityClaim matches an open claim by question and source", () => {
  const match = findExistingOpportunityClaim(BASE_CANDIDATE, [BASE_VS]);
  assert.equal(match?.id, 42);
});

test("findExistingOpportunityClaim falls back to matching positions and source", () => {
  const candidate = {
    ...BASE_CANDIDATE,
    claimText: "Will Bitcoin finish above the threshold before month-end?",
  };

  const match = findExistingOpportunityClaim(candidate, [BASE_VS]);
  assert.equal(match?.id, 42);
});

test("findExistingOpportunityClaim ignores claims from different sources", () => {
  const match = findExistingOpportunityClaim(BASE_CANDIDATE, [
    {
      ...BASE_VS,
      id: 99,
      resolution_url: "https://coinmarketcap.com/currencies/bitcoin/",
    },
  ]);

  assert.equal(match, undefined);
});
