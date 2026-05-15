import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAddressParam,
  parseInviteKey,
  parsePositiveIntegerParam,
} from "../../lib/server/api-validation";

test("parsePositiveIntegerParam accepts positive integer ids", () => {
  assert.equal(parsePositiveIntegerParam("7"), 7);
});

test("parsePositiveIntegerParam rejects missing and invalid ids", () => {
  assert.equal(parsePositiveIntegerParam(undefined), null);
  assert.equal(parsePositiveIntegerParam("0"), null);
  assert.equal(parsePositiveIntegerParam("-1"), null);
  assert.equal(parsePositiveIntegerParam("1.2"), null);
  assert.equal(parsePositiveIntegerParam("abc"), null);
});

test("parseAddressParam accepts a valid EVM address", () => {
  const address = "0x000000000000000000000000000000000000dEaD";
  assert.equal(parseAddressParam(address), address);
});

test("parseAddressParam rejects malformed addresses", () => {
  assert.equal(parseAddressParam(undefined), null);
  assert.equal(parseAddressParam("not-an-address"), null);
  assert.equal(parseAddressParam("0x1234"), null);
});

test("parseInviteKey accepts blank and generated-safe invite values", () => {
  assert.equal(parseInviteKey(null), "");
  assert.equal(parseInviteKey(""), "");
  assert.equal(parseInviteKey("abc123XYZ_-"), "abc123XYZ_-");
});

test("parseInviteKey rejects malformed invite values", () => {
  assert.equal(parseInviteKey("bad value"), null);
  assert.equal(parseInviteKey("slash/value"), null);
  assert.equal(parseInviteKey("*"), null);
});
