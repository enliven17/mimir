/**
 * Self-checks for the x402 paying layer's pure logic:
 *   - buildEip712Payload synthesizes the EIP712Domain entry from domain fields
 *   - usdcToAtomic converts to 6-decimal atomic units
 * (Network/W3S paths are covered by the live demo, not unit tests.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEip712Payload } from "../../lib/circle-w3s";
import { usdcToAtomic } from "../../lib/x402";

test("buildEip712Payload injects EIP712Domain matching present domain fields", () => {
  const out = JSON.parse(
    buildEip712Payload({
      domain: {
        name: "USDC",
        version: "2",
        chainId: 5042002,
        verifyingContract: "0x0000000000000000000000000000000000000001",
      },
      types: {
        TransferWithAuthorization: [{ name: "from", type: "address" }],
      },
      primaryType: "TransferWithAuthorization",
      message: { from: "0x0000000000000000000000000000000000000002" },
    }),
  );

  // EIP712Domain must be present and ordered, with no `salt` (absent from domain).
  assert.deepEqual(out.types.EIP712Domain, [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ]);
  // Original types survive.
  assert.ok(out.types.TransferWithAuthorization);
  assert.equal(out.primaryType, "TransferWithAuthorization");
});

test("buildEip712Payload omits domain fields that aren't supplied", () => {
  const out = JSON.parse(
    buildEip712Payload({
      domain: { name: "X", chainId: 1 },
      types: { Foo: [{ name: "a", type: "uint256" }] },
      primaryType: "Foo",
      message: { a: 1 },
    }),
  );
  assert.deepEqual(out.types.EIP712Domain, [
    { name: "name", type: "string" },
    { name: "chainId", type: "uint256" },
  ]);
});

test("usdcToAtomic uses 6 decimals", () => {
  assert.equal(usdcToAtomic(1), 1_000_000n);
  assert.equal(usdcToAtomic(0.001), 1_000n);
  assert.equal(usdcToAtomic(0.000001), 1n);
});
