/**
 * Multichain plumbing shared by the worker agents.
 *
 * Every worker walks enabledChainKeys(), but only acts on the chains where its
 * W3S wallet exists: wallets are per blockchain, so a missing _BASE id means
 * "sit out on Base", not "crash the worker". The warning fires once, at
 * startup, where an operator reading the boot log will see it.
 */
import { erc20Abi } from "viem";

import { createChainPublicClient } from "../../lib/arc";
import { enabledChainKeys, getChain, stakeUnitsToUsdc, type ChainKey } from "../../lib/chains";
import { walletIdEnvFor, walletIdsFor } from "../../lib/w3s-escrow";
import type { PayingAgent } from "../../lib/x402";

/** Log prefix, e.g. `[oracle][base]`. */
export function chainTag(agent: string, chain: ChainKey): string {
  return `[${agent}][${chain}]`;
}

/**
 * Enabled chains where `baseEnv` has a wallet id, with the chain → wallet id
 * map. Chains without one get a single warning here and are left out.
 */
export function walletChains(
  agent: string,
  baseEnv: string,
): { chains: ChainKey[]; walletIds: Partial<Record<ChainKey, string>> } {
  const enabled = enabledChainKeys();
  const walletIds = walletIdsFor(baseEnv);
  for (const chain of enabled) {
    if (walletIds[chain]) continue;
    console.warn(
      `${chainTag(agent, chain)} ${walletIdEnvFor(baseEnv, chain)} missing — ` +
      `no W3S wallet on ${getChain(chain).name}, skipping this chain.`,
    );
  }
  return { chains: enabled.filter((c) => !!walletIds[c]), walletIds };
}

/**
 * Whole USDC the address can stake on `chain`. Arc stakes native USDC (which
 * also pays gas); the ERC-20 chains stake USDC and pay gas in ETH.
 */
export async function stakeBalanceUsdc(chain: ChainKey, address: `0x${string}`): Promise<number> {
  const client = createChainPublicClient(chain);
  const cfg = getChain(chain);
  if (cfg.stakeMode === "native") {
    return stakeUnitsToUsdc(chain, await client.getBalance({ address }));
  }
  const micro = await client.readContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
  return Number(micro) / 1_000_000;
}

/**
 * x402 payer for work on `preferChain`: pays on that network when the seller
 * offers it, signing with the wallet of whichever network it ends up on.
 * Null when the agent has no wallet anywhere.
 */
export function payingAgentFor(
  baseEnv: string,
  address: `0x${string}`,
  preferChain: ChainKey,
): PayingAgent | null {
  const walletIds = walletIdsFor(baseEnv);
  const walletId = walletIds[preferChain] ?? Object.values(walletIds)[0];
  if (!walletId) return null;
  return { walletId, address, walletIds, preferChain };
}

/** `&chain=<key>` for paid council URLs; Arc is implied when absent. */
export function chainQuery(chain: ChainKey): string {
  return chain === "arc" ? "" : `&chain=${encodeURIComponent(chain)}`;
}
