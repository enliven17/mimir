/**
 * Deposit USDC into Circle's Gateway Wallet so an agent can pay via x402
 * batched (gasless) nanopayments. Signed entirely through W3S — the agent
 * never holds a private key (Mimir's core invariant), unlike Circle's
 * GatewayClient which requires one.
 *
 * A Gateway balance lives on the chain it was deposited on, and a nanopayment
 * settles on one network, so an agent that buys on Arc, Base and Arbitrum
 * needs a deposit on each. Two W3S contract executions per chain:
 *   1. USDC.approve(gatewayWallet, amount)
 *   2. gatewayWallet.deposit(usdc, amount)
 *
 * Run:
 *   DEPOSIT_USDC=5 npm run gateway:deposit                    # oracle, Arc
 *   DEPOSIT_USDC=5 npm run gateway:deposit -- base            # oracle, Base Sepolia
 *   DEPOSIT_USDC=2 npm run gateway:deposit -- all             # oracle, every deployed chain
 *   WALLET=creator DEPOSIT_USDC=5 npm run gateway:deposit -- arbitrum
 *
 * Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_ORACLE_WALLET_ID[_BASE|_ARBITRUM] (+ address)
 */

import { executeContract, toCircleAbiParameters } from "../lib/circle-w3s";
import { usdcToAtomic } from "../lib/x402";
import { GATEWAY_WALLET_ADDRESS } from "../lib/arc";
import { CHAINS, enabledChainKeys, explorerTxUrl, isChainKey, type ChainKey } from "../lib/chains";
import { walletIdFor } from "../lib/w3s-escrow";

const WALLETS: Record<string, { idEnv: string; addressEnv: string }> = {
  oracle: { idEnv: "CIRCLE_ORACLE_WALLET_ID", addressEnv: "CIRCLE_ORACLE_ADDRESS" },
  creator: { idEnv: "CIRCLE_CREATOR_WALLET_ID", addressEnv: "CIRCLE_CREATOR_ADDRESS" },
};

function targetChains(): ChainKey[] {
  const raw = (process.argv[2] ?? process.env.CHAIN ?? "arc").trim().toLowerCase();
  if (raw === "all") return enabledChainKeys();
  if (!isChainKey(raw)) throw new Error(`unknown chain "${raw}" (arc | base | arbitrum | all)`);
  return [raw];
}

async function depositOn(chain: ChainKey, walletId: string, amount: string): Promise<void> {
  const usdc = CHAINS[chain].usdc;
  console.log(`\n[${chain}] approve(gatewayWallet, amount) on USDC ${usdc}...`);
  const approveTx = await executeContract({
    walletId,
    contractAddress: usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: toCircleAbiParameters([GATEWAY_WALLET_ADDRESS, amount]),
    refId: `gw-approve-${chain}`,
  });
  console.log(`      ✓ ${explorerTxUrl(chain, approveTx)}`);

  console.log(`[${chain}] deposit(usdc, amount) on Gateway Wallet...`);
  const depositTx = await executeContract({
    walletId,
    contractAddress: GATEWAY_WALLET_ADDRESS as `0x${string}`,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: toCircleAbiParameters([usdc, amount]),
    refId: `gw-deposit-${chain}`,
  });
  console.log(`      ✓ ${explorerTxUrl(chain, depositTx)}`);
}

async function main(): Promise<void> {
  for (const v of ["CIRCLE_API_KEY", "CIRCLE_ENTITY_SECRET"]) {
    if (!process.env[v]) {
      console.error(`Missing env: ${v}`);
      process.exit(1);
    }
  }

  const which = (process.env.WALLET ?? "oracle").toLowerCase();
  const spec = WALLETS[which];
  if (!spec) throw new Error(`WALLET must be one of: ${Object.keys(WALLETS).join(", ")}`);
  const address = process.env[spec.addressEnv];

  const usdc = Number(process.env.DEPOSIT_USDC ?? "5");
  const amount = usdcToAtomic(usdc).toString(); // 6-decimal atomic units on every chain
  const chains = targetChains();

  console.log("═══════════════════════════════════════════════");
  console.log("  Gateway deposit (W3S-signed, no private key)");
  console.log(`  Wallet : ${which} ${address ?? "(address env unset)"}`);
  console.log(`  Amount : ${usdc} USDC (${amount} atomic) per chain`);
  console.log(`  Chains : ${chains.map((c) => CHAINS[c].name).join(", ")}`);
  console.log(`  Gateway: ${GATEWAY_WALLET_ADDRESS}`);
  console.log("═══════════════════════════════════════════════");

  let failed = 0;
  for (const chain of chains) {
    const walletId = walletIdFor(spec.idEnv, chain);
    if (!walletId) {
      console.warn(`\n[${chain}] skipped: no W3S wallet id (run npm run circle:derive-wallets)`);
      failed++;
      continue;
    }
    try {
      await depositOn(chain, walletId, amount);
    } catch (err) {
      failed++;
      console.error(`[${chain}] FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  if (failed === chains.length) process.exit(1);
  console.log(`\n✅ Gateway deposit done for ${which} on ${chains.length - failed}/${chains.length} chain(s).`);
}

main().catch((err) => {
  console.error("\n[gateway-deposit] FAILED:", err?.message ?? err);
  process.exit(1);
});
