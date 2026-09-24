import assert from "node:assert/strict";
import test from "node:test";

import type { VSData } from "../../lib/contract";
import { ZERO_ADDRESS } from "../../lib/constants";
import {
  canOpenVsXmtpChat,
  getVsXmtpUnavailableReason,
  shouldMountVsXmtpPanelOnDetailPage,
  shouldShowXmtpPeerUnreachableChatPreview,
} from "../../lib/xmtp/vs-chat-eligibility";

const OPP = "0x2222222222222222222222222222222222222222" as const;

function baseVs(overrides: Partial<VSData>): VSData {
  return {
    id: 2,
    creator: "0x1111111111111111111111111111111111111111",
    opponent: ZERO_ADDRESS,
    question: "Q?",
    creator_position: "A",
    opponent_position: "B",
    resolution_url: "https://x.example",
    stake_amount: 5,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    state: "open",
    winner: ZERO_ADDRESS,
    resolution_summary: "",
    created_at: Math.floor(Date.now() / 1000),
    category: "crypto",
    ...overrides,
  };
}

test("shouldMountVsXmtpPanelOnDetailPage: real id", () => {
  const vs = baseVs({ id: 2 });
  assert.equal(shouldMountVsXmtpPanelOnDetailPage(vs), true);
});

test("shouldMountVsXmtpPanelOnDetailPage: negative id omitted", () => {
  const vs = baseVs({ id: -1, max_challengers: 8 });
  assert.equal(shouldMountVsXmtpPanelOnDetailPage(vs), false);
});

test("getVsXmtpUnavailableReason: open 1v1 yields not_accepted", () => {
  const vs = baseVs({ id: 2, max_challengers: 1 });
  assert.equal(getVsXmtpUnavailableReason(vs), "not_accepted");
});

test("getVsXmtpUnavailableReason: accepted multi-challenger", () => {
  const vs = baseVs({
    id: 2,
    state: "accepted",
    opponent: OPP,
    challenger_count: 3,
  });
  assert.equal(getVsXmtpUnavailableReason(vs), "multi_challenger");
});

test("shouldShowXmtpPeerUnreachableChatPreview: never for on-chain VS", () => {
  const vs = baseVs({ id: 2, max_challengers: 1 });
  assert.equal(
    shouldShowXmtpPeerUnreachableChatPreview(vs, "peer_unreachable"),
    false
  );
  assert.equal(shouldShowXmtpPeerUnreachableChatPreview(vs, "network"), false);
});

test("canOpenVsXmtpChat: accepted 1v1", () => {
  const vs = baseVs({
    id: 2,
    state: "accepted",
    opponent: OPP,
    challenger_count: 1,
    max_challengers: 1,
  });
  assert.equal(canOpenVsXmtpChat(vs), true);
  assert.equal(getVsXmtpUnavailableReason(vs), null);
});
