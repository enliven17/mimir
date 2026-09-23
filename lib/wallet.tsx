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
 *
 * Also owns the selected network: the chain new claims are opened on and the
 * chain the wallet is steered to. Only chains with a deployed escrow can be
 * selected; the choice persists in localStorage. Claim pages don't use it for
 * their own actions: a claim lives on one chain, so they call
 * `switchNetwork(claimChain)` instead.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useModal } from "connectkit";
import {
  DEFAULT_CHAIN,
  chainByEvmId,
  enabledChainKeys,
  getChain,
  type ChainKey,
} from "./chains";
import {
  readStoredChain,
  resolveSelectedChain,
  writeStoredChain,
} from "./selectedChain";

interface WalletCtx {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  /** Wallet is on the selected network (true while disconnected). */
  isCorrectNetwork: boolean;
  /** Escrow chain the wallet is on, or null when disconnected / on another chain. */
  walletChain: ChainKey | null;
  /** Network new claims are opened on. */
  selectedChain: ChainKey;
  /** Chains with a deployed escrow, Arc first. */
  enabledChains: ChainKey[];
  /** Persist a new selection and, when connected, switch the wallet to it. */
  setSelectedChain: (key: ChainKey) => void;
  /** True when disconnected or when the wallet is already on `key`. */
  isOnChain: (key: ChainKey) => boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Switch the wallet to `key` (defaults to the selected network). Rejects if the user declines. */
  switchNetwork: (key?: ChainKey) => Promise<void>;
  error: string | null;
  /** Available connectors (MetaMask, Coinbase, etc.) */
  connectors: Array<{ id: string; name: string; connect: () => void }>;
}

const Ctx = createContext<WalletCtx>({
  address: null,
  isConnected: false,
  isConnecting: false,
  isCorrectNetwork: true,
  walletChain: null,
  selectedChain: DEFAULT_CHAIN,
  enabledChains: [DEFAULT_CHAIN],
  setSelectedChain: () => {},
  isOnChain: () => true,
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
  const { switchChainAsync } = useSwitchChain();
  const { setOpen: setConnectKitOpen } = useModal();

  const enabledChains = useMemo(() => enabledChainKeys(), []);

  // Start on the default so server and first client render agree, then adopt
  // the stored choice after mount.
  const [selectedChain, setSelectedState] = useState<ChainKey>(() =>
    resolveSelectedChain(null, enabledChains),
  );
  useEffect(() => {
    setSelectedState(resolveSelectedChain(readStoredChain(), enabledChains));
  }, [enabledChains]);

  const walletChain = chain ? chainByEvmId(chain.id)?.key ?? null : null;
  const isOnChain = useCallback(
    (key: ChainKey) => !chain || chain.id === getChain(key).chain.id,
    [chain],
  );
  const isCorrectNetwork = isOnChain(selectedChain);

  const switchNetwork = useCallback(
    async (key?: ChainKey) => {
      const target = getChain(key ?? selectedChain).chain.id;
      if (chain?.id === target) return;
      // wagmi falls back to wallet_addEthereumChain with the definition in
      // lib/wagmi-config.ts when the wallet doesn't know the chain yet.
      await switchChainAsync({ chainId: target });
    },
    [chain?.id, selectedChain, switchChainAsync],
  );

  // Auto-switch the wallet to the selected network on connect. We keep a
  // per-session "asked" flag in a ref so the user isn't pestered if they
  // reject + re-pick another chain on purpose.
  const autoSwitchAttempted = useRef(false);
  useEffect(() => {
    if (!isConnected || !chain) {
      autoSwitchAttempted.current = false;
      return;
    }
    if (chain.id === getChain(selectedChain).chain.id) return;
    if (autoSwitchAttempted.current) return;
    autoSwitchAttempted.current = true;
    switchChainAsync({ chainId: getChain(selectedChain).chain.id }).catch(() => {
      /* user rejected — wallet stays on its current chain */
    });
  }, [isConnected, chain, selectedChain, switchChainAsync]);

  const setSelectedChain = useCallback(
    (key: ChainKey) => {
      if (!enabledChains.includes(key)) return;
      setSelectedState(key);
      writeStoredChain(key);
      if (isConnected && chain && chain.id !== getChain(key).chain.id) {
        switchChainAsync({ chainId: getChain(key).chain.id }).catch(() => {
          /* declined: the selection still stands, the UI shows the mismatch */
        });
      }
    },
    [enabledChains, isConnected, chain, switchChainAsync],
  );

  // Opens ConnectKit's modal — lets the user pick from every connector wagmi
  // knows about (injected + Coinbase + WalletConnect QR + EIP-6963 discovery).
  // We no longer guess a connector for them; that lost users whose wallet
  // wasn't MetaMask/Coinbase and never tripped the WalletConnect QR path.
  const connectWithFirstAvailable = async () => {
    setConnectKitOpen(true);
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
        walletChain,
        selectedChain,
        enabledChains,
        setSelectedChain,
        isOnChain,
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
