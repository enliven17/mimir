"use client";

/**
 * Wallet context — powered by wagmi + ConnectKit
 *
 * Supports MetaMask, Coinbase Wallet, Rainbow, Phantom, Trust, Brave, OKX,
 * and any EIP-6963 injected wallet. WalletConnect QR adds 380+ mobile
 * wallets when NEXT_PUBLIC_WC_PROJECT_ID is set.
 *
 * Keeps the same useWallet() API so the rest of the app is unchanged —
 * connect() now opens the ConnectKit modal instead of guessing a connector.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { useModal } from "connectkit";
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
  const { setOpen: setConnectKitOpen } = useModal();

  const isCorrectNetwork = !chain || chain.id === arcTestnet.id;

  // Auto-switch the wallet to Arc Testnet on connect. If the chain isn't in
  // the user's wallet, wagmi will fall back to wallet_addEthereumChain using
  // the chain definition in lib/wagmi-config.ts. We keep a per-session "asked"
  // flag in a ref so the user isn't pestered if they reject + re-pick another
  // chain on purpose.
  const autoSwitchAttempted = useRef(false);
  useEffect(() => {
    if (!isConnected || !chain) {
      autoSwitchAttempted.current = false;
      return;
    }
    if (chain.id === arcTestnet.id) return;
    if (autoSwitchAttempted.current) return;
    autoSwitchAttempted.current = true;
    try {
      switchChain({ chainId: arcTestnet.id });
    } catch {
      /* user rejected — wallet stays on its current chain */
    }
  }, [isConnected, chain, switchChain]);

  // Opens ConnectKit's modal — lets the user pick from every connector wagmi
  // knows about (injected + Coinbase + WalletConnect QR + EIP-6963 discovery).
  // We no longer guess a connector for them; that lost users whose wallet
  // wasn't MetaMask/Coinbase and never tripped the WalletConnect QR path.
  const connectWithFirstAvailable = async () => {
    setConnectKitOpen(true);
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
