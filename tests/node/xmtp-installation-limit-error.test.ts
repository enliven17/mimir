import assert from "node:assert/strict";
import test from "node:test";

import { isXmtpInstallationsLimitError } from "../../lib/xmtp/installation-limit-error";

const SAMPLE =
  "Cannot register a new installation because the InboxID 6a965415b0cc7ba16d6e7bc88ed1300e03a59c22f29da704c370f634371b0b4f has already registered 10/10 installations. Please revoke existing installations first.";

test("detects 10/10 installations message", () => {
  assert.equal(isXmtpInstallationsLimitError(SAMPLE), true);
});

test("detects revoke existing installations phrase", () => {
  assert.equal(
    isXmtpInstallationsLimitError(
      "Please revoke existing installations first."
    ),
    true
  );
});

test("detects N/N installations pattern", () => {
  assert.equal(
    isXmtpInstallationsLimitError("already registered 3/5 installations"),
    true
  );
});

test("ignores unrelated errors", () => {
  assert.equal(isXmtpInstallationsLimitError("Wrong chain id"), false);
  assert.equal(isXmtpInstallationsLimitError(""), false);
  assert.equal(isXmtpInstallationsLimitError(null), false);
});
