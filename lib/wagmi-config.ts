/**
 * wagmi config for Mimir on Arc
 *
 * Supports: MetaMask, Coinbase Wallet, WalletConnect, injected wallets
 * Chain: Arc Testnet (5042002), USDC native (18 decimals)
 *
 * This is the equivalent of Circle's "App Kit" —
 * a professional wallet connection layer for Arc.
 */
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask } from "@wagmi/connectors";
import { arcTestnet, getArcRpcUrl } from "./arc";

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [
    metaMask(),
    coinbaseWallet({
      appName: "Mimir",
      appLogoUrl: "https://mimir.app/logo.png",
    }),
    injected({ target: "phantom" }),
    injected(),
  ],
  transports: {
    [arcTestnet.id]: http(getArcRpcUrl()),
  },
  ssr: true,
});

