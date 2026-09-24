import test from "node:test";
import assert from "node:assert/strict";

import { claimEvents } from "../../lib/notifications";

const claim = {
  id: 9,
  chain: "base",
  creator: "0xCreator",
  question: "Will it?",
  state: "active",
  challenger_count: 2,
  challengers: [{ address: "0xA", stake: 5 }, { address: "0xB", stake: 3 }],
};

test("a new challenge notifies the creator once per challenger count", () => {
  const events = claimEvents({ state: "active", challenger_count: 1 }, claim);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "challenged");
  assert.equal(events[0].recipient, "0xcreator");
  assert.equal(events[0].dedupe, "count:2");
  assert.equal(events[0].payload.challenger, "0xB");
});

test("resolution notifies every participant with whether they won", () => {
  const events = claimEvents(
    { state: "active", challenger_count: 2 },
    { ...claim, state: "resolved", winner_side: "challengers", confidence: 90 },
  );
  assert.deepEqual(events.map((e) => e.recipient).sort(), ["0xa", "0xb", "0xcreator"]);
  const creator = events.find((e) => e.recipient === "0xcreator")!;
  assert.equal(creator.payload.youWon, false);
  assert.equal(events.find((e) => e.recipient === "0xa")!.payload.youWon, true);
});

test("first sight and unchanged claims produce nothing", () => {
  assert.deepEqual(claimEvents(null, claim), []);
  assert.deepEqual(claimEvents({ state: "active", challenger_count: 2 }, claim), []);
});
