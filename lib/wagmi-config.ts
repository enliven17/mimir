/**
 * wagmi config for Mimir
 *
 * Supports: MetaMask, Coinbase Wallet, Rainbow, Phantom, Trust, Brave,
 * any EIP-6963 injected wallet, and WalletConnect QR (380+ mobile wallets).
 * The connect modal is rendered by ConnectKit (lib/wagmi-providers.tsx).
 *
 * Escrow chains (lib/chains.ts): Arc Testnet (home, USDC is gas), Base Sepolia
 * and Arbitrum Sepolia (ERC-20 USDC stakes, ETH gas). All three are always
 * registered so the network switcher and the CCTP bridge can target them even
 * when an escrow is not deployed yet.
 *
 * Extra chains are registered so the CCTP V2 bridge can switch users to
 * source chains (Eth/Avalanche Sepolia) for `depositForBurn`, then switch
 * back to the destination for `receiveMessage`.
 */
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask, walletConnect } from "@wagmi/connectors";
import { sepolia, avalancheFuji } from "wagmi/chains";
import { CHAIN_KEYS, getChain } from "./chains";

// WalletConnect Cloud project id — get one free at https://cloud.walletconnect.com.
// When the var is missing we skip the walletconnect connector so local dev still
// works; the connect modal just won't show the QR option until it's set.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();

const APP_METADATA = {
  name:        "Mimir",
  description: "AI-settled USDC claim markets, home on Arc",
  url:         "https://mimir.app",
  icons:       ["https://mimir.app/logo.png"],
};

// JSON-RPC batching + retry keeps the browser from getting throttled
// (HTTP 429) when wagmi's react-query layer fans out useReadContract calls
// — every claim card on the feed page would otherwise issue its own POST.
// Every escrow chain gets the same budget Arc always had.
const ESCROW_HTTP_OPTS = {
  batch: { batchSize: 200, wait: 16 },
  retryCount: 3,
  retryDelay: 300,
  timeout: 20_000,
} as const;

const escrowChains = CHAIN_KEYS.map((k) => getChain(k));
const [arcChain, ...otherEscrowChains] = escrowChains.map((c) => c.chain);

export const wagmiConfig = createConfig({
  chains: [arcChain, ...otherEscrowChains, sepolia, avalancheFuji],
  connectors: [
    metaMask(),
    coinbaseWallet({
      appName:    APP_METADATA.name,
      appLogoUrl: APP_METADATA.icons[0],
    }),
    // EIP-6963 discovery picks up Phantom, Rainbow, Trust, Brave, OKX, etc.
    // automatically — no per-wallet config needed.
    injected({ shimDisconnect: true }),
    ...(WC_PROJECT_ID
      ? [walletConnect({
          projectId:    WC_PROJECT_ID,
          metadata:     APP_METADATA,
          showQrModal:  false, // ConnectKit renders the QR itself
        })]
      : []),
  ],
  transports: {
    ...Object.fromEntries(
      escrowChains.map((c) => [c.chain.id, http(c.rpcUrl, ESCROW_HTTP_OPTS)]),
    ),
    // CCTP-only source chains: viem defaults (single retry, no batch).
    [sepolia.id]:        http(),
    [avalancheFuji.id]:  http(),
  },
  ssr: true,
});
