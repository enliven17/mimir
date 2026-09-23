/**
 * Chain registry — the one place that knows which networks Mimir runs on.
 *
 * Arc is the home chain: USDC is its gas token, stakes move through msg.value
 * at 18 decimals. Base Sepolia and Arbitrum Sepolia run the same MimirV3
 * escrow in ERC-20 mode: stakes are 6-decimal USDC pulled after an approve,
 * gas is ETH. Everything above this file speaks whole-USDC numbers and a
 * ChainKey; the unit and ABI differences stop here.
 *
 * NEXT_PUBLIC_* reads must stay literal (process.process.env.NEXT_PUBLIC_X) so Next
 * can inline them into the browser bundle — no computed env keys below.
 */
import type { Chain } from "viem";
import { arbitrumSepolia, baseSepolia } from "viem/chains";

export const CHAIN_KEYS = ["arc", "base", "arbitrum"] as const;
export type ChainKey = (typeof CHAIN_KEYS)[number];

/** v2 = legacy Mimir.sol (no agent attribution args); v3 = MimirV3. */
export type AbiVersion = "v2" | "v3";

export interface MimirChain {
  key: ChainKey;
  name: string;
  shortName: string;
  chain: Chain;
  /** CAIP-2 id, the x402 wire name for this network. */
  caip2: `eip155:${number}`;
  /** How the escrow takes stakes. */
  stakeMode: "native" | "erc20";
  /** Decimals of the stake amounts the contract stores. */
  stakeDecimals: number;
  /** USDC ERC-20 (Arc exposes a 6-decimal ERC-20 view of native USDC too). */
  usdc: `0x${string}`;
  /** Symbol of the token that pays gas. */
  gasSymbol: string;
  /** Circle W3S blockchain id for developer-controlled wallets. */
  w3sBlockchain: "ARC-TESTNET" | "BASE-SEPOLIA" | "ARB-SEPOLIA";
  /** Circle domain id (CCTP V2 + Gateway share the numbering). */
  circleDomain: number;
  explorerUrl: string;
  /** eth_getLogs block range per call. */
  logChunk: bigint;
  rpcUrl: string;
  contractAddress: `0x${string}` | null;
  deployBlock: bigint;
  abiVersion: AbiVersion;
}

export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    canteen: { http: ["https://arc-node.thecanteenapp.com"] },
  },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
};

const ZERO = "0x0000000000000000000000000000000000000000";
const isServer = typeof window === "undefined";

function addr(raw: string | undefined): `0x${string}` | null {
  const v = raw?.trim();
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) && v !== ZERO ? (v as `0x${string}`) : null;
}

function block(raw: string | undefined, fallback: bigint): bigint {
  try {
    return raw && raw.trim() ? BigInt(raw.trim()) : fallback;
  } catch {
    return fallback;
  }
}

function abi(raw: string | undefined, fallback: AbiVersion): AbiVersion {
  return raw === "v2" || raw === "v3" ? raw : fallback;
}

function chunk(raw: string | undefined): bigint {
  return block(raw, 9_999n);
}

function build(): Record<ChainKey, MimirChain> {

  return {
    arc: {
      key: "arc",
      name: "Arc Testnet",
      shortName: "Arc",
      chain: arcTestnet,
      caip2: `eip155:${arcTestnet.id}`,
      stakeMode: "native",
      stakeDecimals: 18,
      usdc: "0x3600000000000000000000000000000000000000",
      gasSymbol: "USDC",
      w3sBlockchain: "ARC-TESTNET",
      circleDomain: 26,
      explorerUrl: "https://testnet.arcscan.app",
      logChunk: chunk(process.env.NEXT_PUBLIC_ARC_LOG_CHUNK),
      rpcUrl:
        process.env.NEXT_PUBLIC_ARC_RPC ||
        (isServer ? process.env.ARC_RPC : undefined) ||
        "https://rpc.testnet.arc.network",
      contractAddress: addr(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS),
      deployBlock: block(process.env.NEXT_PUBLIC_DEPLOY_BLOCK, 42_719_056n),
      // The live Arc escrow is still v2 until the cutover in docs/MAINNET_CUTOVER.md.
      abiVersion: abi(process.env.NEXT_PUBLIC_ARC_ABI_VERSION, "v2"),
    },
    base: {
      key: "base",
      name: "Base Sepolia",
      shortName: "Base",
      chain: baseSepolia,
      caip2: `eip155:${baseSepolia.id}`,
      stakeMode: "erc20",
      stakeDecimals: 6,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      gasSymbol: "ETH",
      w3sBlockchain: "BASE-SEPOLIA",
      circleDomain: 6,
      explorerUrl: "https://sepolia.basescan.org",
      logChunk: chunk(process.env.NEXT_PUBLIC_BASE_LOG_CHUNK),
      rpcUrl:
        process.env.NEXT_PUBLIC_BASE_RPC ||
        (isServer ? process.env.BASE_RPC : undefined) ||
        "https://sepolia.base.org",
      contractAddress: addr(process.env.NEXT_PUBLIC_BASE_CONTRACT_ADDRESS),
      deployBlock: block(process.env.NEXT_PUBLIC_BASE_DEPLOY_BLOCK, 0n),
      abiVersion: "v3",
    },
    arbitrum: {
      key: "arbitrum",
      name: "Arbitrum Sepolia",
      shortName: "Arbitrum",
      chain: arbitrumSepolia,
      caip2: `eip155:${arbitrumSepolia.id}`,
      stakeMode: "erc20",
      stakeDecimals: 6,
      usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
      gasSymbol: "ETH",
      w3sBlockchain: "ARB-SEPOLIA",
      circleDomain: 3,
      explorerUrl: "https://sepolia.arbiscan.io",
      logChunk: chunk(process.env.NEXT_PUBLIC_ARBITRUM_LOG_CHUNK),
      rpcUrl:
        process.env.NEXT_PUBLIC_ARBITRUM_RPC ||
        (isServer ? process.env.ARBITRUM_RPC : undefined) ||
        "https://sepolia-rollup.arbitrum.io/rpc",
      contractAddress: addr(process.env.NEXT_PUBLIC_ARBITRUM_CONTRACT_ADDRESS),
      deployBlock: block(process.env.NEXT_PUBLIC_ARBITRUM_DEPLOY_BLOCK, 0n),
      abiVersion: "v3",
    },
  };
}

// ponytail: env is fixed per process, so the registry is built once.
export const CHAINS: Record<ChainKey, MimirChain> = build();

export function isChainKey(v: unknown): v is ChainKey {
  return typeof v === "string" && (CHAIN_KEYS as readonly string[]).includes(v);
}

export function getChain(key: ChainKey): MimirChain {
  return CHAINS[key];
}

/** Chains with a deployed escrow. Arc is always first when present. */
export function enabledChains(): MimirChain[] {
  return CHAIN_KEYS.map((k) => CHAINS[k]).filter((c) => c.contractAddress !== null);
}

export function enabledChainKeys(): ChainKey[] {
  return enabledChains().map((c) => c.key);
}

export const DEFAULT_CHAIN: ChainKey = isChainKey(process.process.env.NEXT_PUBLIC_DEFAULT_CHAIN)
  ? process.process.env.NEXT_PUBLIC_DEFAULT_CHAIN
  : "arc";

/** Lenient parse for query strings and request bodies; unknown → default. */
export function parseChainKey(v: unknown, fallback: ChainKey = DEFAULT_CHAIN): ChainKey {
  if (isChainKey(v)) return v;
  if (typeof v === "string" || typeof v === "number") {
    const id = Number(v);
    const hit = CHAIN_KEYS.find((k) => CHAINS[k].chain.id === id);
    if (hit) return hit;
  }
  return fallback;
}

export function chainByEvmId(id: number): MimirChain | undefined {
  return CHAIN_KEYS.map((k) => CHAINS[k]).find((c) => c.chain.id === id);
}

export function chainByCaip2(caip2: string): MimirChain | undefined {
  return CHAIN_KEYS.map((k) => CHAINS[k]).find((c) => c.caip2 === caip2);
}

export function requireContractAddress(key: ChainKey): `0x${string}` {
  const a = CHAINS[key].contractAddress;
  if (!a) throw new Error(`Mimir is not deployed on ${CHAINS[key].name} (contract address unset)`);
  return a;
}

// ── Units ─────────────────────────────────────────────────────────────────────
// Whole USDC in, contract units out. Six decimals of precision everywhere,
// scaled up to 18 on Arc.

export function usdcToStakeUnits(key: ChainKey, usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("Invalid USDC amount");
  const micro = BigInt(Math.round(usdc * 1_000_000));
  const extra = CHAINS[key].stakeDecimals - 6;
  return extra > 0 ? micro * 10n ** BigInt(extra) : micro;
}

export function stakeUnitsToUsdc(key: ChainKey, units: bigint | number | string): number {
  const extra = CHAINS[key].stakeDecimals - 6;
  const micro = extra > 0 ? BigInt(units) / 10n ** BigInt(extra) : BigInt(units);
  return Number(micro) / 1_000_000;
}

// ── Explorer links ────────────────────────────────────────────────────────────

export function explorerTxUrl(key: ChainKey, txHash: string): string {
  return `${CHAINS[key].explorerUrl}/tx/${txHash}`;
}

export function explorerAddressUrl(key: ChainKey, address: string): string {
  return `${CHAINS[key].explorerUrl}/address/${address}`;
}

// ── Cross-chain claim identity ────────────────────────────────────────────────
// Claim ids restart at 1 on every chain, so an id alone is ambiguous. The app
// passes `?chain=` on claim URLs; Arc is implied when absent so every link
// minted before multichain still resolves.

export function claimKey(key: ChainKey, id: number): string {
  return `${key}:${id}`;
}

export function vsPath(id: number, key: ChainKey = DEFAULT_CHAIN, inviteKey = ""): string {
  const q = new URLSearchParams();
  if (key !== "arc") q.set("chain", key);
  if (inviteKey) q.set("invite", inviteKey);
  const qs = q.toString();
  return `/vs/${id}${qs ? `?${qs}` : ""}`;
}

/** `?chain=` on a claim URL. Absent means Arc, never the default chain. */
export function chainFromQuery(v: unknown): ChainKey {
  return parseChainKey(v, "arc");
}
