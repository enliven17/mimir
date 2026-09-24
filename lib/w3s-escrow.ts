/**
 * Chain-aware escrow writes for W3S-signed agents.
 *
 * Agents say "stake 2 USDC on claim 7 on Base"; this module picks the chain's
 * W3S wallet, the ABI its escrow speaks, and how the stake moves: msg.value on
 * Arc, an approve + transferFrom on the ERC-20 chains.
 *
 * W3S wallets are per blockchain. Arc keeps the original env names
 * (CIRCLE_ORACLE_WALLET_ID); Base and Arbitrum use the same name with a
 * _BASE / _ARBITRUM suffix. The address is shared: the wallets are derived from
 * one wallet set, so an agent is the same account on every chain.
 */
import { erc20Abi, type Hex } from "viem";

import { createChainPublicClient, getContractAddress } from "./arc";
import { getChain, usdcToStakeUnits, type ChainKey } from "./chains";
import {
  buildAbiFunctionSignature,
  executeContract,
  toCircleAbiParameters,
} from "./circle-w3s";
import { MIMIR_ABI } from "./mimir-abi";
import { MIMIR_V3_ABI } from "./mimir-v3-abi";
import { assertNotPaused, capabilityForEscrowCall } from "./ops/flags";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SUFFIX: Record<ChainKey, string> = { arc: "", base: "_BASE", arbitrum: "_ARBITRUM" };

/** Env var holding `baseEnv`'s wallet id on `chain`, e.g. CIRCLE_ORACLE_WALLET_ID_BASE. */
export function walletIdEnvFor(baseEnv: string, chain: ChainKey): string {
  return `${baseEnv}${SUFFIX[chain]}`;
}

export function walletIdFor(baseEnv: string, chain: ChainKey): string | undefined {
  return process.env[walletIdEnvFor(baseEnv, chain)]?.trim() || undefined;
}

export function requireWalletIdFor(baseEnv: string, chain: ChainKey): string {
  const id = walletIdFor(baseEnv, chain);
  if (!id) throw new Error(`${walletIdEnvFor(baseEnv, chain)} missing (W3S wallet on ${getChain(chain).name})`);
  return id;
}

/** Every chain's wallet id for an agent, for signers that follow the payment's network. */
export function walletIdsFor(baseEnv: string): Partial<Record<ChainKey, string>> {
  const out: Partial<Record<ChainKey, string>> = {};
  for (const chain of ["arc", "base", "arbitrum"] as const) {
    const id = walletIdFor(baseEnv, chain);
    if (id) out[chain] = id;
  }
  return out;
}

export interface EscrowWriteArgs {
  chain: ChainKey;
  walletId: string;
  /** The wallet's address; needed to check the ERC-20 allowance. */
  owner: `0x${string}`;
  functionName: "createClaim" | "challengeClaim" | "resolveClaim" | "cancelClaim" | "createRematch" | "withdraw" | "claimFees";
  /** Args as the v2 ABI takes them; v3 attribution is appended here. */
  args: readonly unknown[];
  /** Whole USDC the call stakes. 0 for non-staking calls. */
  stakeUsdc?: number;
  /** v3 only: agent owner credited for this position. */
  agentOwner?: `0x${string}`;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  refId?: string;
  /**
   * Target a specific escrow instead of the chain's live one, e.g. the Arc V3
   * deploy that sits beside v2 until cutover. Its ABI version must be given too.
   */
  escrow?: { address: `0x${string}`; abiVersion: "v2" | "v3" };
}

function callFor(abiVersion: "v2" | "v3", functionName: string, args: readonly unknown[], agentOwner?: string) {
  if (abiVersion === "v2") return { abi: MIMIR_ABI as readonly unknown[], args };
  const attributed =
    functionName === "createClaim" || functionName === "challengeClaim"
      ? [...args, agentOwner ?? ZERO_ADDRESS]
      : args;
  return { abi: MIMIR_V3_ABI as readonly unknown[], args: attributed };
}

/**
 * ERC-20 chains: approve exactly what this stake needs when the allowance is
 * short. Exact rather than unlimited, so the escrow can never reach more of an
 * agent's USDC than the position it is opening.
 */
async function ensureW3SAllowance(a: EscrowWriteArgs, need: bigint): Promise<void> {
  const cfg = getChain(a.chain);
  const spender = a.escrow?.address ?? getContractAddress(a.chain);
  const allowance = await createChainPublicClient(a.chain).readContract({
    address: cfg.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [a.owner, spender],
  });
  if (allowance >= need) return;
  await executeContract({
    walletId: a.walletId,
    contractAddress: cfg.usdc,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [spender, need.toString()],
    feeLevel: a.feeLevel,
  });
}

/** Submit an escrow call through W3S and wait for the tx hash. */
export async function w3sEscrowWrite(a: EscrowWriteArgs): Promise<Hex> {
  // Every agent write funnels through here, so the pause switches bite before
  // anything is signed, whichever worker asked.
  const capability = capabilityForEscrowCall(a.functionName);
  if (capability) assertNotPaused(capability);
  const cfg = getChain(a.chain);
  const stake = a.stakeUsdc ?? 0;
  if (stake > 0 && cfg.stakeMode === "erc20") {
    await ensureW3SAllowance(a, usdcToStakeUnits(a.chain, stake));
  }
  const call = callFor(a.escrow?.abiVersion ?? cfg.abiVersion, a.functionName, a.args, a.agentOwner);
  return executeContract({
    walletId: a.walletId,
    contractAddress: a.escrow?.address ?? getContractAddress(a.chain),
    abiFunctionSignature: buildAbiFunctionSignature(a.functionName, call.abi),
    abiParameters: toCircleAbiParameters(call.args),
    // Circle takes msg.value as a decimal token amount, never wei.
    ...(stake > 0 && cfg.stakeMode === "native" ? { amount: stake.toFixed(6) } : {}),
    feeLevel: a.feeLevel,
    refId: a.refId,
  });
}
