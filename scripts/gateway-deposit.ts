/**
 * Deposit USDC into Circle's Gateway Wallet so an agent can pay via x402
 * batched (gasless) nanopayments. Signed entirely through W3S — the agent
 * never holds a private key (Mimir's core invariant), unlike Circle's
 * GatewayClient which requires one.
 *
 * Two W3S contract executions on Arc Testnet:
 *   1. USDC.approve(gatewayWallet, amount)
 *   2. gatewayWallet.deposit(usdc, amount)
 *
 * Run:
 *   DEPOSIT_USDC=5 npm run gateway:deposit            # oracle (default)
 *   WALLET=creator DEPOSIT_USDC=5 npm run gateway:deposit
 *
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_WALLET_ID (+ address)
 */

import { executeContract, toCircleAbiParameters, getOracleWalletId, getOracleAddress, getMarketCreatorWalletId, getMarketCreatorAddress } from "../lib/circle-w3s";
import { usdcToAtomic } from "../lib/x402";
import { getExplorerTxUrl } from "../lib/arc";

// Arc Testnet Gateway addresses (from @circle-fin/x402-batching CHAIN_CONFIGS).
const USDC = "0x3600000000000000000000000000000000000000" as const;
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET", "CIRCLE_ORACLE_WALLET_ID", "CIRCLE_ORACLE_ADDRESS"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }

  const which = (process.env.WALLET ?? "oracle").toLowerCase();
  const walletId = which === "creator" ? getMarketCreatorWalletId() : getOracleWalletId();
  const address = which === "creator" ? getMarketCreatorAddress() : getOracleAddress();

  const usdc = Number(process.env.DEPOSIT_USDC ?? "5");
  const amount = usdcToAtomic(usdc).toString(); // 6-decimal atomic units

  console.log("═══════════════════════════════════════════════");
  console.log("  Gateway deposit (W3S-signed, no private key)");
  console.log(`  Wallet : ${which} ${address}`);
  console.log(`  Amount : ${usdc} USDC (${amount} atomic)`);
  console.log(`  Gateway: ${GATEWAY_WALLET}`);
  console.log("═══════════════════════════════════════════════\n");

  console.log("[1/2] approve(gatewayWallet, amount) on USDC...");
  const approveTx = await executeContract({
    walletId,
    contractAddress: USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: toCircleAbiParameters([GATEWAY_WALLET, amount]),
    refId: "gw-approve",
  });
  console.log(`      ✓ ${getExplorerTxUrl(approveTx)}`);

  console.log("[2/2] deposit(usdc, amount) on Gateway Wallet...");
  const depositTx = await executeContract({
    walletId,
    contractAddress: GATEWAY_WALLET,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: toCircleAbiParameters([USDC, amount]),
    refId: "gw-deposit",
  });
  console.log(`      ✓ ${getExplorerTxUrl(depositTx)}`);

  console.log(`\n✅ Deposited ${usdc} USDC into Gateway for ${which}. Batched x402 payments enabled.`);
}

main().catch((err) => {
  console.error("\n[gateway-deposit] FAILED:", err?.message ?? err);
  process.exit(1);
});
