/**
 * Quick read of both Mimir agent wallets on every enabled chain.
 * Stake balance is USDC (native on Arc, ERC-20 elsewhere); on the ERC-20
 * chains gas is ETH, shown alongside.
 * Run: npx tsx scripts/check-agent-balances.ts
 */
import { formatEther } from "viem";

import { createChainPublicClient, getExplorerAddressUrl } from "../lib/arc";
import { enabledChainKeys, getChain, type ChainKey } from "../lib/chains";
import { stakeBalanceUsdc } from "../agents/shared/chains";

async function line(chain: ChainKey, label: string, address: `0x${string}`): Promise<string> {
  const cfg = getChain(chain);
  const usdc = await stakeBalanceUsdc(chain, address)
    .then((v) => `${v.toFixed(4)} USDC`)
    .catch(() => "USDC unavailable (RPC error)");
  // Arc pays gas in the same native USDC; only the ERC-20 chains need a gas line.
  const gas = cfg.stakeMode === "erc20"
    ? await createChainPublicClient(chain).getBalance({ address })
        .then((wei) => ` · ${Number(formatEther(wei)).toFixed(5)} ${cfg.gasSymbol} gas`)
        .catch(() => ` · ${cfg.gasSymbol} unavailable`)
    : "";
  return `  ${label.padEnd(15)} ${usdc}${gas}\n                  ${getExplorerAddressUrl(address, chain)}`;
}

async function main(): Promise<void> {
  const oracle  = process.env.CIRCLE_ORACLE_ADDRESS;
  const creator = process.env.CIRCLE_CREATOR_ADDRESS;
  if (!oracle || !creator) {
    console.error("Missing CIRCLE_ORACLE_ADDRESS or CIRCLE_CREATOR_ADDRESS");
    process.exit(1);
  }

  console.log(`oracle          ${oracle}`);
  console.log(`market-creator  ${creator}\n`);
  for (const chain of enabledChainKeys()) {
    console.log(`${getChain(chain).name} balances:`);
    console.log(await line(chain, "oracle", oracle as `0x${string}`));
    console.log(await line(chain, "market-creator", creator as `0x${string}`));
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
