/**
 * wagmi config for Mimir on Arc
 *
 * Supports: MetaMask, Coinbase Wallet, WalletConnect, injected wallets
 * Primary chain: Arc Testnet (5042002), USDC native (18 decimals)
 *
 * Extra chains are registered so the CCTP V2 bridge can switch users to
 * source chains (Base/Eth/Avalanche Sepolia) for `depositForBurn`, then
 * switch back to Arc for `receiveMessage`.
 */
import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, metaMask } from "@wagmi/connectors";
import { sepolia, baseSepolia, avalancheFuji } from "wagmi/chains";
import { arcTestnet, getArcRpcUrl } from "./arc";

export const wagmiConfig = createConfig({
  chains: [arcTestnet, sepolia, baseSepolia, avalancheFuji],
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
    [arcTestnet.id]:     http(getArcRpcUrl()),
    [sepolia.id]:        http(),
    [baseSepolia.id]:    http(),
    [avalancheFuji.id]:  http(),
  },
  ssr: true,
});

