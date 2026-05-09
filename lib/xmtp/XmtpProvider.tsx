"use client";

/**
 * Contexto del cliente XMTP (Paso 4).
 *
 * - Crea `Client` con `Client.create(signer, options)` cuando hay wallet conectada.
 * - Respeta `NEXT_PUBLIC_FEATURE_XMTP` (sin crear cliente si está desactivado).
 * - Cierra el cliente con `close()` al desconectar, cambiar cuenta o desmontar (doc XMTP).
 *
 * Debe montarse **dentro** de `WalletProvider`.
 *
 * @see https://docs.xmtp.org/chat-apps/core-messaging/create-a-client
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
import { Client, type XmtpEnv } from "@xmtp/browser-sdk";
import { useWallet } from "@/lib/wallet";
import type { XmtpClientInstance } from "@/lib/xmtp/types";
import {
  getXmtpClientCreateOptions,
  isXmtpFeatureEnabled,
} from "@/lib/xmtp/config";
import {
  createXmtpSignerFromEthereum,
  type EthereumEip1193Provider,
} from "@/lib/xmtp/signer";

export type XmtpClientStatus =
  /** Sin wallet o aún no aplicable */
  | "idle"
  /** `NEXT_PUBLIC_FEATURE_XMTP` no está activo */
  | "disabled"
  /** Creando cliente (puede solicitar firma al registrar inbox) */
  | "initializing"
  | "ready"
  | "error"
  /** XMTP is already active in another tab (OPFS lock conflict) */
  | "blocked_by_tab";

export type XmtpContextValue = {
  /** Instancia lista para `conversations`, etc. Solo con `status === "ready"`. */
  client: XmtpClientInstance | null;
  status: XmtpClientStatus;
  error: Error | null;
  /** Dirección con la que se intentó / logró inicializar (null si idle/disabled). */
  activeAddress: string | null;
  /** Indica si la feature flag está encendida (build-time). */
  featureEnabled: boolean;
  /** Reintenta `Client.create` tras un fallo (misma cuenta). */
  retry: () => void;
};

const defaultValue: XmtpContextValue = {
  client: null,
  status: "idle",
  error: null,
  activeAddress: null,
  featureEnabled: false,
  retry: () => {},
};

const XmtpCtx = createContext<XmtpContextValue>(defaultValue);

/* ── OPFS tab-lock via BroadcastChannel ── */
const XMTP_TAB_LOCK_CHANNEL = "proven-xmtp-tab-lock";
const XMTP_TAB_LOCK_KEY = "proven-xmtp-tab-owner";

function isXmtpOpfsStorageError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "");

  return /NoModificationAllowedError|sync access handle|createSyncAccessHandle|FileSystemSyncAccessHandle|OPFS/i.test(
    message
  );
}

function createXmtpInitTimeout(timeoutMs: number) {
  return new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            "XMTP client initialization timed out. Try closing other tabs or clearing site data."
          )
        ),
      timeoutMs
    )
  );
}

function acquireTabLock(tabId: string): { acquired: boolean; release: () => void } {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return { acquired: true, release: () => {} };
  }

  const existing = sessionStorage.getItem(XMTP_TAB_LOCK_KEY);
  // If this tab already owns the lock, allow it
  if (existing === tabId) {
    return { acquired: true, release: () => sessionStorage.removeItem(XMTP_TAB_LOCK_KEY) };
  }

  // Try to claim via localStorage (cross-tab)
  const now = Date.now();
  const raw = localStorage.getItem(XMTP_TAB_LOCK_KEY);
  if (raw) {
    try {
      const lock = JSON.parse(raw) as { tabId: string; ts: number };
      // If the lock is from another tab and still fresh (< 30s), we're blocked
      if (lock.tabId !== tabId && now - lock.ts < 30_000) {
        return { acquired: false, release: () => {} };
      }
    } catch { /* corrupt, overwrite */ }
  }

  // Claim the lock
  localStorage.setItem(XMTP_TAB_LOCK_KEY, JSON.stringify({ tabId, ts: now }));
  sessionStorage.setItem(XMTP_TAB_LOCK_KEY, tabId);

  // Keep the lock alive with a heartbeat
  const heartbeat = setInterval(() => {
    localStorage.setItem(XMTP_TAB_LOCK_KEY, JSON.stringify({ tabId, ts: Date.now() }));
  }, 10_000);

  // Notify other tabs
  try {
    const ch = new BroadcastChannel(XMTP_TAB_LOCK_CHANNEL);
    ch.postMessage({ type: "xmtp-lock-acquired", tabId });
    ch.close();
  } catch { /* BroadcastChannel not supported */ }

  const release = () => {
    clearInterval(heartbeat);
    try {
      const current = localStorage.getItem(XMTP_TAB_LOCK_KEY);
      if (current) {
        const parsed = JSON.parse(current) as { tabId: string };
        if (parsed.tabId === tabId) localStorage.removeItem(XMTP_TAB_LOCK_KEY);
      }
    } catch { /* ignore */ }
    sessionStorage.removeItem(XMTP_TAB_LOCK_KEY);
  };

  return { acquired: true, release };
}

function getTabId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem("proven-tab-id");
  if (!id) {
    id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("proven-tab-id", id);
  }
  return id;
}
/* ── end tab-lock ── */

function getInjectedEthereum(): EthereumEip1193Provider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: EthereumEip1193Provider })
    .ethereum;
  return eth ?? null;
}

export function XmtpProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useWallet();
  const featureEnabled = useMemo(() => isXmtpFeatureEnabled(), []);

  const [client, setClient] = useState<XmtpClientInstance | null>(null);
  const [status, setStatus] = useState<XmtpClientStatus>(
    featureEnabled ? "idle" : "disabled"
  );
  const [error, setError] = useState<Error | null>(null);
  const [activeAddress, setActiveAddress] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const clientRef = useRef<XmtpClientInstance | null>(null);
  const initGenRef = useRef(0);
  const tabId = useMemo(() => getTabId(), []);
  const lockReleaseRef = useRef<(() => void) | null>(null);

  const retry = useCallback(() => {
    setRetryTrigger((n) => n + 1);
  }, []);

  // Listen for lock releases from other tabs so we can auto-retry
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !featureEnabled) return;
    const ch = new BroadcastChannel(XMTP_TAB_LOCK_CHANNEL);
    ch.onmessage = (ev) => {
      if (ev.data?.type === "xmtp-lock-released" && status === "blocked_by_tab") {
        retry();
      }
    };
    return () => ch.close();
  }, [featureEnabled, status, retry]);

  // Release lock on unmount / page unload
  useEffect(() => {
    const handleUnload = () => {
      lockReleaseRef.current?.();
      try {
        const ch = new BroadcastChannel(XMTP_TAB_LOCK_CHANNEL);
        ch.postMessage({ type: "xmtp-lock-released", tabId });
        ch.close();
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      handleUnload();
    };
  }, [tabId]);

  useEffect(() => {
    if (!featureEnabled) {
      setStatus("disabled");
      setClient(null);
      setActiveAddress(null);
      setError(null);
      if (clientRef.current) {
        try {
          clientRef.current.close();
        } catch {
          /* ignore */
        }
        clientRef.current = null;
      }
      return;
    }

    if (!isConnected || !address) {
      initGenRef.current += 1;
      if (clientRef.current) {
        try {
          clientRef.current.close();
        } catch {
          /* ignore */
        }
        clientRef.current = null;
      }
      lockReleaseRef.current?.();
      lockReleaseRef.current = null;
      setClient(null);
      setActiveAddress(null);
      setError(null);
      setStatus("idle");
      return;
    }

    const ethereum = getInjectedEthereum();
    if (!ethereum) {
      setClient(null);
      setActiveAddress(null);
      setError(new Error("XMTP: no injected Ethereum provider"));
      setStatus("error");
      return;
    }

    // Check tab lock before attempting Client.create
    const lock = acquireTabLock(tabId);
    if (!lock.acquired) {
      setClient(null);
      setActiveAddress(address);
      setError(new Error("Chat is active in another tab. Close it to use chat here."));
      setStatus("blocked_by_tab");
      return;
    }
    lockReleaseRef.current = lock.release;

    const myGen = ++initGenRef.current;
    setStatus("initializing");
    setError(null);
    setActiveAddress(address);

    (async () => {
      let newClient: XmtpClientInstance | null = null;
      try {
        const signer = createXmtpSignerFromEthereum(ethereum, address);
        const opts = getXmtpClientCreateOptions();
        const XMTP_INIT_TIMEOUT_MS = 15_000;
        const clientOptions = {
          env: opts.env as XmtpEnv,
          appVersion: opts.appVersion,
        } as Parameters<typeof Client.create>[1];
        const clientPromise = Client.create(signer, clientOptions);
        try {
          newClient = await Promise.race([
            clientPromise,
            createXmtpInitTimeout(XMTP_INIT_TIMEOUT_MS),
          ]);
        } catch (initializationError) {
          if (!isXmtpOpfsStorageError(initializationError)) {
            throw initializationError;
          }

          console.warn(
            "XMTP OPFS storage unavailable, retrying with in-memory storage.",
            initializationError
          );

          newClient = await Promise.race([
            Client.create(signer, {
              ...clientOptions,
              dbPath: null,
            } as Parameters<typeof Client.create>[1]),
            createXmtpInitTimeout(XMTP_INIT_TIMEOUT_MS),
          ]);
        }

        if (myGen !== initGenRef.current) {
          newClient.close();
          return;
        }

        if (clientRef.current && clientRef.current !== newClient) {
          try {
            clientRef.current.close();
          } catch {
            /* ignore */
          }
        }

        clientRef.current = newClient;
        setClient(newClient);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (myGen !== initGenRef.current) {
          newClient?.close();
          return;
        }
        newClient?.close();
        clientRef.current = null;
        setClient(null);
        const err =
          e instanceof Error ? e : new Error(String(e ?? "XMTP init failed"));
        setError(err);
        setStatus("error");
      }
    })();

    return () => {
      initGenRef.current += 1;
      if (clientRef.current) {
        try {
          clientRef.current.close();
        } catch {
          /* ignore */
        }
        clientRef.current = null;
      }
      setClient(null);
    };
  }, [
    featureEnabled,
    isConnected,
    address,
    retryTrigger,
    tabId,
  ]);

  const value = useMemo<XmtpContextValue>(
    () => ({
      client,
      status,
      error,
      activeAddress,
      featureEnabled,
      retry,
    }),
    [client, status, error, activeAddress, featureEnabled, retry]
  );

  return <XmtpCtx.Provider value={value}>{children}</XmtpCtx.Provider>;
}

export function useXmtp(): XmtpContextValue {
  return useContext(XmtpCtx);
}
