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

// Pulled out so the rest of the file can read the URL without optional-chain noise.
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";

/** Circle's Gateway Wallet on Arc — where batched x402 nanopayments settle on-chain. */
export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

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
      url: ARC_EXPLORER_URL,
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

// Arc public RPC enforces `eth_getLogs` ≤ 10,000 blocks per call. We start
// scans from the contract's deploy block and chunk in 10k batches.
export const ARC_LOG_CHUNK = 9_999n;

export function getDeployBlock(): bigint {
  const raw = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
  if (raw && raw.trim().length > 0) {
    try { return BigInt(raw); } catch { /* fall through */ }
  }
  return 42_719_056n;
}

export async function paginatedGetLogs(
  client: PublicClient,
  params: Omit<Parameters<PublicClient["getLogs"]>[0], "fromBlock" | "toBlock">,
  fromBlock: bigint,
  toBlock?: bigint,
): Promise<any[]> {
  const end = toBlock ?? (await client.getBlockNumber());
  const all: any[] = [];
  for (let start = fromBlock; start <= end; ) {
    const stop = start + ARC_LOG_CHUNK > end ? end : start + ARC_LOG_CHUNK;
    const logs = await client.getLogs({ ...(params as any), fromBlock: start, toBlock: stop });
    all.push(...logs);
    start = stop + 1n;
  }
  return all;
}

export function getExplorerTxUrl(txHash: string): string {
  return `${ARC_EXPLORER_URL}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}

// ── viem clients ──────────────────────────────────────────────────────────────
// Arc public RPC returns HTTP 429 when slammed with 100+ parallel single-call
// readContracts (a 100-claim feed × 3 reads per claim = 300 simultaneous
// POSTs). viem's JSON-RPC batch transport bundles all eth_call requests that
// fire within `wait` ms into one POST body, which drops the request count by
// ~100x and keeps us under the throttle. retryCount/retryDelay also smooth
// over the rare 429 that still slips through.
const ARC_HTTP_OPTS = {
  batch: { batchSize: 200, wait: 16 } as const,
  retryCount: 3,
  retryDelay: 300,
  timeout: 20_000,
};

export function createArcPublicClient(): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(getArcRpcUrl(), ARC_HTTP_OPTS),
  }) as PublicClient;
}

export function createArcHttpTransport() {
  return http(getArcRpcUrl(), ARC_HTTP_OPTS);
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
    transport: http(getArcRpcUrl(), ARC_HTTP_OPTS),
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
          blockExplorerUrls: [ARC_EXPLORER_URL],
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

export function usdcToWei(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc < 0) throw new Error("Invalid USDC amount");
  // Support up to 6 significant decimal places (standard USDC precision)
  return BigInt(Math.round(usdc * 1_000_000)) * BigInt(10 ** 12);
}

export function weiToUsdc(micro: bigint | number): number {
  return Number(BigInt(micro) / BigInt(10 ** 12)) / 1_000_000;
}

export function formatUsdc(micro: bigint | number, decimals = 2): string {
  return weiToUsdc(micro).toFixed(decimals) + " USDC";
}
