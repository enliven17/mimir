/**
 * CCTP V2 — Cross-Chain Transfer Protocol helpers
 *
 * Bridges USDC from any V2 chain to Arc Testnet (and back) via burn-and-mint.
 * Reference: https://developers.circle.com/cctp
 *
 * V2 flow (Fast Transfer mode, ~13–19s finality):
 *   1. Source chain: approve USDC → call TokenMessengerV2.depositForBurn(...)
 *   2. Off-chain  : poll Iris API for attestation
 *   3. Dest chain : call MessageTransmitterV2.receiveMessage(message, attestation)
 *
 * Contract addresses are identical across all V2-supported chains (CREATE2 deploy).
 * Only the domain ID and USDC ERC-20 token differ per chain.
 */

import { pad, type Hex, type Address } from "viem";

// ── Universal V2 contracts ────────────────────────────────────────────────────
export const TOKEN_MESSENGER_V2     = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as Address;
export const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as Address;

// ── Iris attestation service ──────────────────────────────────────────────────
export const IRIS_TESTNET = "https://iris-api-sandbox.circle.com";
export const IRIS_MAINNET = "https://iris-api.circle.com";

// ── Finality thresholds (V2) ──────────────────────────────────────────────────
export const FINALITY_FAST     = 1000;   // ~13–19s, may charge a small fee
export const FINALITY_STANDARD = 2000;   // hard-finality (chain dependent)

// ── Supported chains (testnets only for now) ──────────────────────────────────
export interface CctpChain {
  name:        string;
  chainId:     number;
  domain:      number;
  usdc:        Address;
  rpcUrl?:     string;
  explorerUrl: string;
}

export const CCTP_CHAINS: Record<string, CctpChain> = {
  arcTestnet: {
    name:        "Arc Testnet",
    chainId:     5042002,
    domain:      26,
    usdc:        "0x3600000000000000000000000000000000000000" as Address,
    rpcUrl:      "https://rpc.testnet.arc.network",
    explorerUrl: "https://testnet.arcscan.app",
  },
  ethSepolia: {
    name:        "Ethereum Sepolia",
    chainId:     11155111,
    domain:      0,
    usdc:        "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address,
    explorerUrl: "https://sepolia.etherscan.io",
  },
  baseSepolia: {
    name:        "Base Sepolia",
    chainId:     84532,
    domain:      6,
    usdc:        "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    explorerUrl: "https://sepolia.basescan.org",
  },
  avalancheFuji: {
    name:        "Avalanche Fuji",
    chainId:     43113,
    domain:      1,
    usdc:        "0x5425890298aed601595a70AB815c96711a31Bc65" as Address,
    explorerUrl: "https://testnet.snowtrace.io",
  },
};

export function getChainByDomain(domain: number): CctpChain | undefined {
  return Object.values(CCTP_CHAINS).find((c) => c.domain === domain);
}

export function getChainById(chainId: number): CctpChain | undefined {
  return Object.values(CCTP_CHAINS).find((c) => c.chainId === chainId);
}

// ── ABIs ──────────────────────────────────────────────────────────────────────
export const TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function", name: "depositForBurn", stateMutability: "nonpayable",
    inputs: [
      { name: "amount",                type: "uint256" },
      { name: "destinationDomain",     type: "uint32"  },
      { name: "mintRecipient",         type: "bytes32" },
      { name: "burnToken",             type: "address" },
      { name: "destinationCaller",     type: "bytes32" },
      { name: "maxFee",                type: "uint256" },
      { name: "minFinalityThreshold",  type: "uint32"  },
    ],
    outputs: [{ type: "uint64", name: "nonce" }],
  },
] as const;

export const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: "function", name: "receiveMessage", stateMutability: "nonpayable",
    inputs: [
      { name: "message",     type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool", name: "success" }],
  },
] as const;

export const ERC20_USDC_ABI = [
  {
    type: "function", name: "approve", stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function", name: "allowance", stateMutability: "view",
    inputs: [
      { name: "owner",   type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "balanceOf", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function", name: "decimals", stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
export function addressToBytes32(addr: Address): Hex {
  return pad(addr.toLowerCase() as Address, { size: 32 }) as Hex;
}

export const BYTES32_ZERO: Hex = `0x${"00".repeat(32)}` as Hex;

// ── Iris attestation polling ──────────────────────────────────────────────────
export interface IrisMessage {
  attestation:     Hex;
  message:         Hex;
  eventNonce:      string;
  cctpVersion:     number;
  status:          "pending_confirmations" | "complete";
  decodedMessage?: unknown;
}

/**
 * Poll Iris for a CCTP V2 message attestation.
 * Returns the first message that becomes "complete" or throws on timeout.
 */
export async function pollIrisAttestation(
  sourceDomain: number,
  burnTxHash:   Hex,
  opts: { network?: "testnet" | "mainnet"; timeoutMs?: number; intervalMs?: number } = {},
): Promise<IrisMessage> {
  const host       = opts.network === "mainnet" ? IRIS_MAINNET : IRIS_TESTNET;
  const url        = `${host}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  const timeoutMs  = opts.timeoutMs  ?? 120_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const json = (await res.json()) as { messages?: IrisMessage[] };
        const msg = json.messages?.find((m) => m.status === "complete");
        if (msg) return msg;
      }
    } catch {
      // transient — retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Iris attestation timed out after ${timeoutMs}ms for tx ${burnTxHash}`);
}
