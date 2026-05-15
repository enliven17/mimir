import assert from "node:assert/strict";
import test from "node:test";

import type { VSData } from "../../lib/contract";
import {
  MOCK_CREATED_VS_ID,
  buildMockCreatedVsTemplate,
} from "../../lib/mockVsCreate";
import { ZERO_ADDRESS } from "../../lib/constants";
import {
  canOpenVsXmtpChat,
  getVsXmtpUnavailableReason,
  isOneVsOneDemoVs,
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

test("shouldMountVsXmtpPanelOnDetailPage: explore sample -1 omitted", () => {
  const vs = baseVs({ id: -1, max_challengers: 8 });
  assert.equal(shouldMountVsXmtpPanelOnDetailPage(vs), false);
});

test("isOneVsOneDemoVs / mount: -4 template 1v1", () => {
  const tpl = buildMockCreatedVsTemplate();
  assert.equal(isOneVsOneDemoVs(tpl), true);
  assert.equal(shouldMountVsXmtpPanelOnDetailPage(tpl), true);
});

test("isOneVsOneDemoVs: -4 with max_challengers > 1 not demo chat slot", () => {
  const tpl = buildMockCreatedVsTemplate();
  const multi = { ...tpl, max_challengers: 8 };
  assert.equal(isOneVsOneDemoVs(multi), false);
  assert.equal(shouldMountVsXmtpPanelOnDetailPage(multi), false);
});

test("getVsXmtpUnavailableReason: -4 open yields not_accepted not sample", () => {
  const tpl = buildMockCreatedVsTemplate();
  assert.equal(getVsXmtpUnavailableReason(tpl), "not_accepted");
});

test("getVsXmtpUnavailableReason: -4 accepted multi-challenger preview", () => {
  const vs: VSData = {
    ...buildMockCreatedVsTemplate(),
    state: "accepted",
    opponent: OPP,
    challenger_count: 3,
  };
  assert.equal(getVsXmtpUnavailableReason(vs), "multi_challenger");
});

test("shouldShowXmtpPeerUnreachableChatPreview: demo 1v1 only", () => {
  const demo = buildMockCreatedVsTemplate();
  assert.equal(
    shouldShowXmtpPeerUnreachableChatPreview(demo, "peer_unreachable"),
    true
  );
  assert.equal(shouldShowXmtpPeerUnreachableChatPreview(demo, "network"), false);
  assert.equal(
    shouldShowXmtpPeerUnreachableChatPreview(baseVs({ id: 2 }), "peer_unreachable"),
    false
  );
});

test("canOpenVsXmtpChat: -4 accepted 1v1", () => {
  const vs: VSData = {
    ...buildMockCreatedVsTemplate(),
    id: MOCK_CREATED_VS_ID,
    state: "accepted",
    opponent: OPP,
    challenger_count: 1,
    creator: "0x1111111111111111111111111111111111111111",
  };
  assert.equal(canOpenVsXmtpChat(vs), true);
  assert.equal(getVsXmtpUnavailableReason(vs), null);
});
