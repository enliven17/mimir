import test from "node:test";
import assert from "node:assert/strict";

import { txErrorMessage } from "../../lib/tx-errors";

test("txErrorMessage turns wallet errors into one readable line", () => {
  const rejected = Object.assign(new Error("long\nviem\ndump"), {
    shortMessage: "User rejected the request.",
    cause: { name: "UserRejectedRequestError", code: 4001 },
  });
  assert.equal(txErrorMessage(rejected), "You rejected the request in your wallet.");

  const reverted = Object.assign(new Error("dump"), {
    shortMessage: "The contract function \"challengeClaim\" reverted.",
    cause: { reason: "Mimir: claim is full" },
  });
  assert.equal(txErrorMessage(reverted), "Transaction reverted: Mimir: claim is full");

  const funds = Object.assign(new Error("x"), { shortMessage: "insufficient funds for gas * price + value" });
  assert.match(txErrorMessage(funds), /Not enough funds/);

  assert.equal(txErrorMessage(new Error("first line\nsecond line")), "first line");
  assert.equal(txErrorMessage(null), "Transaction failed. Please try again.");
});
