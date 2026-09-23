import assert from "node:assert/strict";
import test from "node:test";

import {
  chainFromQuery,
  parseChainKey,
  stakeUnitsToUsdc,
  usdcToStakeUnits,
  vsPath,
} from "../../lib/chains";

test("stake units follow each chain's decimals", () => {
  assert.equal(usdcToStakeUnits("arc", 2), 2n * 10n ** 18n);
  assert.equal(usdcToStakeUnits("base", 2), 2_000_000n);
  assert.equal(usdcToStakeUnits("arbitrum", 0.000001), 1n);
  assert.equal(stakeUnitsToUsdc("arc", 5_500_000_000_000_000_000n), 5.5);
  assert.equal(stakeUnitsToUsdc("base", 5_500_000n), 5.5);
  assert.throws(() => usdcToStakeUnits("base", -1));
});

test("claim URLs stay backwards compatible for Arc", () => {
  assert.equal(vsPath(7, "arc"), "/vs/7");
  assert.equal(vsPath(7, "base"), "/vs/7?chain=base");
  assert.equal(vsPath(7, "arbitrum", "k"), "/vs/7?chain=arbitrum&invite=k");
  // A link without ?chain= always meant Arc, whatever the default chain is.
  assert.equal(chainFromQuery(null), "arc");
  assert.equal(chainFromQuery("base"), "base");
});

test("chain keys parse from names and EVM ids", () => {
  assert.equal(parseChainKey("84532"), "base");
  assert.equal(parseChainKey(421614), "arbitrum");
  assert.equal(parseChainKey("nope", "arc"), "arc");
});
