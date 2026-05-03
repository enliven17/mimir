"use client";

/**
 * Wallet context — powered by wagmi
 *
 * Supports MetaMask, Coinbase Wallet, Phantom, and any injected wallet.
 * Keeps the same useWallet() API so the rest of the app is unchanged.
 */
import React, { createContext, useContext, useMemo } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { arcTestnet } from "./arc";

interface WalletCtx {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isCorrectNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  error: string | null;
  /** Available connectors (MetaMask, Coinbase, etc.) */
  connectors: Array<{ id: string; name: string; connect: () => void }>;
}

const Ctx = createContext<WalletCtx>({
  address: null,
  isConnected: false,
  isConnecting: false,
  isCorrectNetwork: true,
  connect: async () => {},
  disconnect: () => {},
  switchNetwork: async () => {},
  error: null,
  connectors: [],
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const isCorrectNetwork = !chain || chain.id === arcTestnet.id;

  const connectWithFirstAvailable = async () => {
    // Try MetaMask first, then Coinbase, then any injected
    const preferred = connectors.find((c) => c.id === "metaMask")
      ?? connectors.find((c) => c.id === "coinbaseWallet")
      ?? connectors[0];
    if (preferred) {
      connect({ connector: preferred });
    }
  };

  const switchNetwork = async () => {
    switchChain({ chainId: arcTestnet.id });
  };

  const connectorList = useMemo(
    () =>
      connectors.map((c) => ({
        id: c.id,
        name: c.name,
        connect: () => connect({ connector: c }),
      })),
    [connectors, connect]
  );

  const error = connectError
    ? connectError.message.includes("rejected")
      ? "rejected"
      : "error"
    : null;

  return (
    <Ctx.Provider
      value={{
        address: address ?? null,
        isConnected,
        isConnecting: isPending,
        isCorrectNetwork,
        connect: connectWithFirstAvailable,
        disconnect,
        switchNetwork,
        error,
        connectors: connectorList,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  return useContext(Ctx);
}
