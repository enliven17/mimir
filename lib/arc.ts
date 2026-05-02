/**
 * Arc chain configuration (Circle L1)
 * Chain ID: 5042002 (0x4cef52) — Arc Testnet
 * Native currency: USDC (18 decimals at EVM level) — used for gas AND stakes
 * Note: Arc uses 18 decimals for the native USDC token (like ETH on Ethereum),
 * but displays as 6 significant decimal places in wallets.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Chain definition ──────────────────────────────────────────────────────────
export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
    canteen: {
      http: ["https://arc-node.thecanteenapp.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
};

// ── RPC endpoint ──────────────────────────────────────────────────────────────
export function getArcRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_ARC_RPC ||
    (typeof window === "undefined" ? process.env.ARC_RPC : undefined) ||
    arcTestnet.rpcUrls.default.http[0]
  );
}

export function getContractAddress(): `0x${string}` {
  const addr =
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
    "0x0000000000000000000000000000000000000000";
  return addr as `0x${string}`;
}

export function getExplorerTxUrl(txHash: string): string {
  return `${arcTestnet.blockExplorers.default.url}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${arcTestnet.blockExplorers.default.url}/address/${address}`;
}

// ── viem clients ──────────────────────────────────────────────────────────────
export function createArcPublicClient(): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(getArcRpcUrl()),
  }) as PublicClient;
}

export function createArcWalletClient(provider: unknown): WalletClient {
  return createWalletClient({
    chain: arcTestnet,
    transport: custom(provider as any),
  });
}

export function createArcWalletClientWithKey(privateKey: string): WalletClient {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    chain: arcTestnet,
    account,
    transport: http(getArcRpcUrl()),
  });
}

// ── MetaMask chain-switch helper ──────────────────────────────────────────────
export async function ensureArcChain(ethereum: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): Promise<void> {
  const chainIdHex = `0x${arcTestnet.id.toString(16)}`;
  const currentChainId = (await ethereum.request({ method: "eth_chainId" })) as string;

  if (currentChainId === chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: arcTestnet.name,
          rpcUrls: arcTestnet.rpcUrls.default.http,
          nativeCurrency: arcTestnet.nativeCurrency,
          blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
        },
      ],
    });
  }
}

// ── Unit helpers ──────────────────────────────────────────────────────────────
// Arc USDC: 18 decimals at EVM level (like ETH on Ethereum)
// Display: 6 significant decimal places (standard USDC display)
// 1 USDC = 1_000_000_000_000_000_000 wei
export const USDC_DECIMALS = 18;
export const USDC_UNIT = BigInt(10 ** USDC_DECIMALS); // 1_000_000_000_000_000_000n

export function usdcToMicro(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("Invalid USDC amount");
  // Support up to 6 significant decimal places (standard USDC precision)
  return BigInt(Math.round(usdc * 1_000_000)) * BigInt(10 ** 12);
}

export function microToUsdc(micro: bigint | number): number {
  return Number(BigInt(micro) / BigInt(10 ** 12)) / 1_000_000;
}

export function formatUsdc(micro: bigint | number, decimals = 2): string {
  return microToUsdc(micro).toFixed(decimals) + " USDC";
}
