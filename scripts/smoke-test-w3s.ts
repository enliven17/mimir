/**
 * End-to-end smoke test for the W3S → Mimir contract path on Arc Testnet.
 *
 * 1. Reads the deployed contract's oracle/owner/claimCount via Arc RPC.
 * 2. Creates one test claim from the market-creator W3S wallet via
 *    Circle's contract-execution endpoint.
 * 3. Re-reads claimCount and verifies the new claim is on-chain.
 *
 * Proves the entire stack works without needing ANTHROPIC_API_KEY.
 *
 * Run: npx tsx --env-file=.env.local scripts/smoke-test-w3s.ts
 */

import {
  createArcPublicClient,
  getContractAddress,
  getExplorerTxUrl,
  microToUsdc,
  usdcToMicro,
} from "../lib/arc";
import {
  executeContract,
  buildAbiFunctionSignature,
  toCircleAbiParameters,
  getMarketCreatorWalletId,
  getMarketCreatorAddress,
} from "../lib/circle-w3s";
import { MIMIR_ABI } from "../lib/mimir-abi";

async function main(): Promise<void> {
  const client          = createArcPublicClient();
  const contractAddress = getContractAddress();
  if (contractAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("NEXT_PUBLIC_CONTRACT_ADDRESS not set — deploy first");
  }
  const creatorWallet = getMarketCreatorWalletId();
  const creatorAddr   = getMarketCreatorAddress();

  console.log(`Contract: ${contractAddress}`);
  console.log(`Funder  : ${creatorAddr}\n`);

  // ── Phase 1: read existing on-chain state ───────────────────────────────────
  const [oracle, owner, claimCountBefore, balance] = await Promise.all([
    client.readContract({ address: contractAddress, abi: MIMIR_ABI, functionName: "oracle" }) as Promise<string>,
    client.readContract({ address: contractAddress, abi: MIMIR_ABI, functionName: "owner"  }) as Promise<string>,
    client.readContract({ address: contractAddress, abi: MIMIR_ABI, functionName: "claimCount" }) as Promise<bigint>,
    client.getBalance({ address: creatorAddr }),
  ]);

  console.log("On-chain state:");
  console.log(`  oracle()     ${oracle}`);
  console.log(`  owner()      ${owner}`);
  console.log(`  claimCount() ${claimCountBefore}`);
  console.log(`  funder bal   ${microToUsdc(balance).toFixed(4)} USDC\n`);

  // ── Phase 2: create a test claim via W3S ────────────────────────────────────
  const stake = usdcToMicro(2);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 60); // 1h

  console.log("Submitting createClaim() via W3S…");
  const txHash = await executeContract({
    walletId:             creatorWallet,
    contractAddress,
    abiFunctionSignature: buildAbiFunctionSignature("createClaim", MIMIR_ABI),
    abiParameters: toCircleAbiParameters([
      "Mimir × Circle smoke test — BTC closes above $100k in 1 hour?",
      "Yes, above $100k",
      "No, below $100k",
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      deadline,
      stake,
      "crypto",
      0n,             // parentId
      "binary",       // marketType
      "pool",         // oddsMode
      0n,             // challengerPayoutBps
      "",             // handicapLine
      "Settle from CoinGecko BTC USD spot at deadline",
      100n,           // maxChallengers
      false,          // isPrivate
      "",             // inviteKey
    ]),
    amount: "2",
    refId:  `smoke-${Date.now()}`,
  });
  console.log(`  tx: ${getExplorerTxUrl(txHash)}\n`);

  // ── Phase 3: verify state changed ───────────────────────────────────────────
  const claimCountAfter = (await client.readContract({
    address: contractAddress, abi: MIMIR_ABI, functionName: "claimCount",
  })) as bigint;

  console.log(`claimCount: ${claimCountBefore} → ${claimCountAfter}`);
  if (claimCountAfter <= claimCountBefore) {
    throw new Error("claimCount did not increase — write may have reverted");
  }

  console.log("\n✓ W3S stack verified end-to-end:");
  console.log("  • RPC reads OK");
  console.log("  • Circle W3S signed + broadcasted the tx");
  console.log("  • Contract accepted the call from the W3S address");
  console.log("  • Native USDC msg.value transferred from W3S wallet\n");
}

main().catch((err) => {
  console.error("Smoke test failed:", err?.message ?? err);
  process.exit(1);
});
