/**
 * wagmi config for Mimir on Arc
 *
 * Supports: MetaMask, Coinbase Wallet, Rainbow, Phantom, Trust, Brave,
 * any EIP-6963 injected wallet, and WalletConnect QR (380+ mobile wallets).
 * The connect modal is rendered by ConnectKit (lib/wagmi-providers.tsx).
 *
 * Primary chain: Arc Testnet (5042002), USDC native (18 decimals).
 *
 * Extra chains are registered so the CCTP V2 bridge can switch users to
 * source chains (Base/Eth/Avalanche Sepolia) for `depositForBurn`, then
 * switch back to Arc for `receiveMessage`.
 */
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask, walletConnect } from "@wagmi/connectors";
import { sepolia, baseSepolia, avalancheFuji } from "wagmi/chains";
import { arcTestnet, getArcRpcUrl } from "./arc";

// WalletConnect Cloud project id — get one free at https://cloud.walletconnect.com.
// When the var is missing we skip the walletconnect connector so local dev still
// works; the connect modal just won't show the QR option until it's set.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID?.trim();

const APP_METADATA = {
  name:        "Mimir",
  description: "AI-settled USDC claim markets on Arc",
  url:         "https://mimir.app",
  icons:       ["https://mimir.app/logo.png"],
};

export const wagmiConfig = createConfig({
  chains: [arcTestnet, sepolia, baseSepolia, avalancheFuji],
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
  // JSON-RPC batching + retry on Arc keeps the browser from getting throttled
  // (HTTP 429) when wagmi's react-query layer fans out useReadContract calls
  // — every claim card on the feed page would otherwise issue its own POST.
  // Other chains use viem defaults (a single retry, no batch) since they're
  // only touched during the CCTP bridge handshake.
  transports: {
    [arcTestnet.id]: http(getArcRpcUrl(), {
      batch: { batchSize: 200, wait: 16 },
      retryCount: 3,
      retryDelay: 300,
      timeout: 20_000,
    }),
    [sepolia.id]:        http(),
    [baseSepolia.id]:    http(),
    [avalancheFuji.id]:  http(),
  },
  ssr: true,
});

