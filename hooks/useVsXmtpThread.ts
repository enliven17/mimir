"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConsentState,
  type DecodedMessage,
  type Dm,
} from "@xmtp/browser-sdk";
import type { XmtpClientInstance } from "@/lib/xmtp/types";
import {
  classifyXmtpThreadError,
  ensureVsDmThread,
  loadThreadMessages,
  type XmtpThreadErrorKind,
} from "@/lib/xmtp/chat-thread";

const VISIBILITY_REFRESH_MIN_MS = 4000;

export type VsXmtpThreadPhase = "idle" | "loading" | "ready" | "error";

export type VsXmtpThreadError = {
  kind: XmtpThreadErrorKind;
  /** Mensaje técnico (logs / soporte); la UI debe mapear `kind` a i18n. */
  technical: string;
};

export type UseVsXmtpThreadOptions = {
  /** Wallet + VS elegible + peer conocido; no exige XMTP listo. */
  threadEligible: boolean;
  /** Cliente listo (solo con `xmtpStatus === "ready"`). */
  client: XmtpClientInstance | null;
  peerAddress: string;
};

export type UseVsXmtpThreadResult = {
  phase: VsXmtpThreadPhase;
  dm: Dm | null;
  messages: DecodedMessage[];
  threadError: VsXmtpThreadError | null;
  isRefreshing: boolean;
  /** Sincroniza lista global + hilo y vuelve a cargar mensajes. */
  refreshThread: () => Promise<void>;
  /** Reinicia apertura del hilo (p. ej. tras error). */
  retryOpenThread: () => void;
  clearThreadError: () => void;
};

/**
 * Ciclo de vida del DM 1v1 VS: sync/consent (Paso 6), stream en vivo,
 * refresco al volver a la pestaña (throttle) y refresco manual.
 */
export function useVsXmtpThread({
  threadEligible,
  client,
  peerAddress,
}: UseVsXmtpThreadOptions): UseVsXmtpThreadResult {
  const isNonFatalSyncNotice = useCallback((message: string) => {
    // XMTP can surface sync telemetry as an "error" string even when successful.
    // Example: "[GroupError::Sync] synced 1 messages, 0 failed 1 succeeded ..."
    return (
      /^\[GroupError::Sync\]/.test(message) &&
      /\b0\s+failed\b/i.test(message) &&
      /\bsucceeded\b/i.test(message)
    );
  }, []);
  const [phase, setPhase] = useState<VsXmtpThreadPhase>("idle");
  const [dm, setDm] = useState<Dm | null>(null);
  const [messages, setMessages] = useState<DecodedMessage[]>([]);
  const [threadError, setThreadError] = useState<VsXmtpThreadError | null>(
    null
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Incrementar para forzar re-ejecución del efecto de apertura tras error. */
  const [openRetryNonce, setOpenRetryNonce] = useState(0);

  const initGen = useRef(0);
  const dmRef = useRef<Dm | null>(null);
  const clientRef = useRef<XmtpClientInstance | null>(null);
  const peerRef = useRef(peerAddress);
  const lastVisibilityRefreshAt = useRef(0);
  const wasHiddenRef = useRef(false);

  useEffect(() => {
    dmRef.current = dm;
  }, [dm]);

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    peerRef.current = peerAddress;
  }, [peerAddress]);

  const clearThreadError = useCallback(() => setThreadError(null), []);

  const retryOpenThread = useCallback(() => {
    setThreadError(null);
    setPhase("idle");
    setDm(null);
    setMessages([]);
    setOpenRetryNonce((n) => n + 1);
  }, []);

  const refreshThread = useCallback(async () => {
    const c = clientRef.current;
    const d = dmRef.current;
    const peer = peerRef.current;
    if (!c || !d || !peer) return;

    setIsRefreshing(true);
    clearThreadError();
    try {
      await c.conversations.syncAll([ConsentState.Allowed]);
      await d.sync();
      const next = await loadThreadMessages(d);
      setMessages(next);
    } catch (e) {
      const { kind, message } = classifyXmtpThreadError(e);
      if (isNonFatalSyncNotice(message)) {
        return;
      }
      setThreadError({ kind, technical: message });
    } finally {
      setIsRefreshing(false);
    }
  }, [clearThreadError, isNonFatalSyncNotice]);

  const throttledVisibilityRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastVisibilityRefreshAt.current < VISIBILITY_REFRESH_MIN_MS) {
      return;
    }
    lastVisibilityRefreshAt.current = now;
    void refreshThread();
  }, [refreshThread]);

  useEffect(() => {
    if (!threadEligible || !client) {
      initGen.current += 1;
      setPhase("idle");
      setDm(null);
      setMessages([]);
      setThreadError(null);
      return;
    }

    const myGen = ++initGen.current;
    setPhase("loading");
    setThreadError(null);

    let streamEnd: (() => Promise<unknown>) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { dm: opened, messages: initial } = await ensureVsDmThread(
          client,
          peerAddress,
          { timeoutMs: 20000 }
        );

        if (cancelled || myGen !== initGen.current) return;

        setDm(opened);
        setMessages(initial);
        setPhase("ready");

        const stream = await opened.stream({
          onValue: (msg) => {
            if (myGen !== initGen.current) return;
            setMessages((prev) => {
              if (prev.some((p) => p.id === msg.id)) return prev;
              return [...prev, msg].sort(
                (a, b) => a.sentAt.getTime() - b.sentAt.getTime()
              );
            });
          },
          onError: (err) => {
            console.warn("[useVsXmtpThread] stream", err);
          },
        });
        streamEnd = () => stream.end();
      } catch (e) {
        if (cancelled || myGen !== initGen.current) return;
        const { kind, message } = classifyXmtpThreadError(e);
        if (isNonFatalSyncNotice(message)) {
          setPhase("idle");
          setThreadError(null);
          return;
        }
        setThreadError({ kind, technical: message });
        setPhase("error");
        setDm(null);
        setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
      initGen.current += 1;
      void streamEnd?.();
      setDm(null);
      setMessages([]);
    };
  }, [threadEligible, client, peerAddress, openRetryNonce]);

  /**
   * Safety net: if the open flow gets stuck without throwing (SDK/worker edge cases),
   * fail fast into a recoverable error state instead of showing "Opening conversation…" forever.
   */
  useEffect(() => {
    if (!threadEligible) return;
    if (phase !== "loading") return;
    const myGen = initGen.current;
    const id = window.setTimeout(() => {
      // Only trip if we're still on the same init generation and still loading.
      if (initGen.current !== myGen) return;
      setThreadError({ kind: "network", technical: "XMTP_OPEN_TIMEOUT" });
      setPhase("error");
      setDm(null);
      setMessages([]);
    }, 25_000);
    return () => window.clearTimeout(id);
  }, [threadEligible, phase]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (phase !== "ready" || !dm) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHiddenRef.current = true;
        return;
      }
      if (
        document.visibilityState === "visible" &&
        wasHiddenRef.current
      ) {
        wasHiddenRef.current = false;
        throttledVisibilityRefresh();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, dm, throttledVisibilityRefresh]);

  return {
    phase,
    dm,
    messages,
    threadError,
    isRefreshing,
    refreshThread,
    retryOpenThread,
    clearThreadError,
  };
}
