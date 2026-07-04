/**
 * Quick read of both Mimir agent wallets on Arc Testnet.
 * Run: npx tsx scripts/check-agent-balances.ts
 */
import { createArcPublicClient, weiToUsdc, getExplorerAddressUrl } from "../lib/arc";

async function main(): Promise<void> {
  const oracle  = process.env.CIRCLE_ORACLE_ADDRESS;
  const creator = process.env.CIRCLE_CREATOR_ADDRESS;
  if (!oracle || !creator) {
    console.error("Missing CIRCLE_ORACLE_ADDRESS or CIRCLE_CREATOR_ADDRESS");
    process.exit(1);
  }

  const client = createArcPublicClient();
  const [ob, cb] = await Promise.all([
    client.getBalance({ address: oracle  as `0x${string}` }),
    client.getBalance({ address: creator as `0x${string}` }),
  ]);

  console.log("Arc Testnet balances:\n");
  console.log(`  oracle          ${oracle}`);
  console.log(`                  ${weiToUsdc(ob).toFixed(4)} USDC`);
  console.log(`                  ${getExplorerAddressUrl(oracle)}\n`);
  console.log(`  market-creator  ${creator}`);
  console.log(`                  ${weiToUsdc(cb).toFixed(4)} USDC`);
  console.log(`                  ${getExplorerAddressUrl(creator)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
