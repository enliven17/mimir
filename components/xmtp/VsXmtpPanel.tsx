"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { VSData } from "@/lib/contract";
import { useWallet } from "@/lib/wallet";
import { useXmtp } from "@/lib/xmtp/XmtpProvider";
import {
  canOpenVsXmtpChat,
  getVsXmtpPeerAddress,
  getVsXmtpUnavailableReason,
  isOneVsOneDemoVs,
  shouldShowXmtpPeerUnreachableChatPreview,
} from "@/lib/xmtp/vs-chat-eligibility";
import { shortenAddress } from "@/lib/constants";
import { Button, Input } from "@/components/ui";
import VsXmtpChatPreviewShell from "@/components/xmtp/VsXmtpChatPreviewShell";
import {
  isXmtpInstallationsLimitError,
  XMTP_INBOX_TOOLS_URL,
} from "@/lib/xmtp/installation-limit-error";
import {
  ExternalLink,
  Lock,
  MessageCircle,
  MonitorSmartphone,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useVsXmtpThread } from "@/hooks/useVsXmtpThread";
import { getDecodedMessageText } from "@/lib/xmtp/chat-thread";
import {
  decodedMessageMatchesPending,
  mergeThreadDisplayRows,
  normalizeXmtpMessageId,
  type OptimisticPendingMessage,
} from "@/lib/xmtp/optimistic-send";
import { GlassCard } from "@/components/ui";

const XMTP_PANEL_TITLE_FALLBACK: Record<string, string> = {
  en: "XMTP MESSAGES",
  es: "MENSAJES XMTP",
};

/** IDs de mensajes propios ocultos solo en esta vista (localStorage). */
function hiddenMyMessagesStorageKey(peerAddress: string, inboxId: string): string {
  return `proven-xmtp-vs-hidden-my:${peerAddress.toLowerCase()}:${inboxId}`;
}

function formatMessageTime(d: Date, locale: string): string {
  const tag = locale.startsWith("es") ? "es-ES" : "en-US";
  return d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
}

/** Same card width/centering as `/vs/[id]`. Hub passes `embedded` only to drop bottom margin inside its scroll parent. */
function vsPanelPageShell(embedded: boolean) {
  const layout = "w-full lg:mx-auto lg:max-w-[800px]";
  return embedded ? `${layout} mb-0` : `${layout} mb-6 sm:mb-8`;
}

/** Single scroll + padding spec for thread log (hub and VS detail must match). */
const VS_XMTP_PANEL_THREAD_SCROLL_CLASS =
  "max-h-[min(42vh,280px)] min-h-[128px] overflow-y-auto px-3 py-2.5 sm:max-h-[min(48vh,360px)] sm:min-h-[140px] sm:px-3.5 sm:py-3";

export type VsXmtpPanelProps = { vs: VSData; embedded?: boolean };

export default function VsXmtpPanel({ vs, embedded = false }: VsXmtpPanelProps) {
  const locale = useLocale();
  const t = useTranslations("xmtpVs");
  const panelTitle = useMemo(() => {
    const v = t("title");
    if (typeof v === "string" && v.startsWith("xmtpVs.")) {
      return XMTP_PANEL_TITLE_FALLBACK[locale] ?? XMTP_PANEL_TITLE_FALLBACK.en;
    }
    return v;
  }, [t, locale]);
  const { address, isConnected, connect } = useWallet();
  const {
    client,
    status: xmtpStatus,
    error: xmtpError,
    featureEnabled,
    retry,
  } = useXmtp();

  const [sendError, setSendError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingSends, setPendingSends] = useState<OptimisticPendingMessage[]>(
    []
  );
  const [hiddenMyMessageIds, setHiddenMyMessageIds] = useState<Set<string>>(
    () => new Set()
  );

  const peerAddress = useMemo(
    () => getVsXmtpPeerAddress(vs, address),
    [vs, address]
  );

  useEffect(() => {
    setPendingSends([]);
    setSendError(null);
    setDraft("");
  }, [peerAddress]);

  useEffect(() => {
    if (!peerAddress || !client?.inboxId) {
      setHiddenMyMessageIds(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(
        hiddenMyMessagesStorageKey(peerAddress, client.inboxId)
      );
      if (!raw) {
        setHiddenMyMessageIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setHiddenMyMessageIds(new Set());
        return;
      }
      setHiddenMyMessageIds(
        new Set(
          parsed
            .map((id) => normalizeXmtpMessageId(id))
            .filter(Boolean)
        )
      );
    } catch {
      setHiddenMyMessageIds(new Set());
    }
  }, [peerAddress, client?.inboxId]);

  const showChrome = featureEnabled && canOpenVsXmtpChat(vs);

  const threadEligible =
    showChrome &&
    isConnected &&
    Boolean(address) &&
    Boolean(peerAddress) &&
    xmtpStatus === "ready" &&
    Boolean(client);

  const {
    phase: threadPhase,
    dm,
    messages,
    threadError,
    isRefreshing,
    refreshThread,
    retryOpenThread,
    clearThreadError,
  } = useVsXmtpThread({
    threadEligible,
    client: client ?? null,
    peerAddress: peerAddress ?? "",
  });

  const isXmtpBoot = xmtpStatus === "initializing";
  const isBlockedByTab = xmtpStatus === "blocked_by_tab";
  const isXmtpProviderError =
    xmtpStatus === "error" || (xmtpStatus === "ready" && !client);

  const innerLoading =
    threadEligible &&
    (threadPhase === "loading" || threadPhase === "idle");

  const innerReady = threadEligible && threadPhase === "ready" && dm;
  const innerThreadError =
    threadEligible && threadPhase === "error" && threadError;

  const showPeerUnreachablePreview =
    Boolean(threadError) &&
    shouldShowXmtpPeerUnreachableChatPreview(vs, threadError?.kind);

  const xmtpProviderErrorMessage = xmtpError?.message ?? "";
  const showInboxToolsForInstallLimit = useMemo(
    () => isXmtpInstallationsLimitError(xmtpProviderErrorMessage),
    [xmtpProviderErrorMessage]
  );

  const threadErrorLabel = useMemo(() => {
    if (!threadError) return null;
    switch (threadError.kind) {
      case "peer_unreachable":
        return t("peerUnreachable");
      case "rate_limit":
        return t("rateLimited");
      case "network":
        return t("networkError");
      default:
        return threadError.technical || t("errorGeneric");
    }
  }, [threadError, t]);

  /** Cuando el stream incorpora el mensaje real, quita la burbuja optimista. */
  useEffect(() => {
    const myInboxId = client?.inboxId;
    setPendingSends((prev) =>
      prev.filter((p) => {
        if (!p.serverMessageId) return true;
        return !messages.some((m) =>
          decodedMessageMatchesPending(m, p, { myInboxId })
        );
      })
    );
  }, [messages, client?.inboxId]);

  const displayRows = useMemo(() => {
    const merged = mergeThreadDisplayRows(messages, pendingSends, {
      myInboxId: client?.inboxId,
    });
    const myInbox = client?.inboxId;
    if (!myInbox) return merged;
    return merged.filter((row) => {
      if (row.kind === "pending") return true;
      if (row.message.senderInboxId !== myInbox) return true;
      return !hiddenMyMessageIds.has(normalizeXmtpMessageId(row.message.id));
    });
  }, [messages, pendingSends, client?.inboxId, hiddenMyMessageIds]);

  const hasMyVisibleToClear = useMemo(() => {
    const myInbox = client?.inboxId;
    if (!myInbox) return false;
    if (pendingSends.length > 0) return true;
    return messages.some((m) => {
      if (m.senderInboxId !== myInbox) return false;
      return !hiddenMyMessageIds.has(normalizeXmtpMessageId(m.id));
    });
  }, [client?.inboxId, messages, pendingSends, hiddenMyMessageIds]);

  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayRows]);

  const handleSend = useCallback(async () => {
    if (!dm) return;
    const text = draft.trim();
    if (!text) return;
    clearThreadError();
    setSendError(null);
    const clientTempId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sentAt = new Date();
    setDraft("");
    setPendingSends((prev) => [
      ...prev,
      { clientTempId, text, sentAt, status: "sending" },
    ]);
    try {
      const rawId = await dm.sendText(text, true);
      const serverMessageId =
        rawId == null ? undefined : String(rawId);
      setPendingSends((prev) =>
        prev.map((p) =>
          p.clientTempId === clientTempId
            ? { ...p, serverMessageId, status: "sent" as const }
            : p
        )
      );
    } catch (e) {
      setPendingSends((prev) =>
        prev.filter((p) => p.clientTempId !== clientTempId)
      );
      setSendError(e instanceof Error ? e.message : String(e));
    }
  }, [dm, draft, clearThreadError]);

  const handleClearMyMessages = useCallback(() => {
    const myInbox = client?.inboxId;
    if (!myInbox || !peerAddress) return;
    if (!hasMyVisibleToClear) return;
    if (typeof window !== "undefined" && !window.confirm(t("clearMyMessagesConfirm"))) {
      return;
    }
    const idsFromThread = messages
      .filter((m) => m.senderInboxId === myInbox)
      .map((m) => normalizeXmtpMessageId(m.id))
      .filter(Boolean);
    setHiddenMyMessageIds((prev) => {
      const next = new Set(prev);
      idsFromThread.forEach((id) => next.add(id));
      try {
        localStorage.setItem(
          hiddenMyMessagesStorageKey(peerAddress, myInbox),
          JSON.stringify(Array.from(next))
        );
      } catch { /* quota / private mode */ }
      return next;
    });
    setPendingSends([]);
    setSendError(null);
  }, [
    client?.inboxId,
    peerAddress,
    messages,
    hasMyVisibleToClear,
    t,
  ]);

  const unavailableCopy = useMemo(() => {
    if (canOpenVsXmtpChat(vs)) return null;
    const reason = getVsXmtpUnavailableReason(vs);
    if (reason === "multi_challenger") return t("unavailableMultiChallenger");
    if (reason === "waiting_opponent") return t("unavailableWaitingOpponent");
    if (reason === "not_accepted") return t("unavailableNotAccepted");
    return t("needsAccepted");
  }, [vs, t]);

  if (!featureEnabled) {
    if (isOneVsOneDemoVs(vs)) {
      return (
        <div
          className={`card border border-white/[0.08] p-5 ${vsPanelPageShell(embedded)}`}
        >
          <div className="flex min-w-0 gap-3 sm:gap-3.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-muted/15 text-pv-muted"
              aria-hidden
            >
              <MessageCircle size={16} strokeWidth={2} />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                {t("featureOffTitle")}
              </h3>
              <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                {t("featureOffDesc")}
              </p>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  if (!canOpenVsXmtpChat(vs)) {
    return (
      <GlassCard
        glass
        glow="none"
        noPad
        className={`!rounded-2xl border border-white/[0.12] ${vsPanelPageShell(embedded)}`}
      >
        <div className="flex w-full min-w-0 items-start gap-3 px-5 py-5 sm:gap-3.5 sm:px-8 sm:py-6">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
            aria-hidden
          >
            <MessageCircle size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
              {panelTitle}
            </h3>
            <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
              {unavailableCopy}
            </p>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!isConnected || !address) {
    return (
      <div
        className={`card border border-white/[0.08] p-5 ${vsPanelPageShell(embedded)}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3 sm:gap-3.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
              aria-hidden
            >
              <MessageCircle size={16} strokeWidth={2} />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                {panelTitle}
              </h3>
              <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                {t("needsWallet")}
              </p>
            </div>
          </div>
          <Button type="button" variant="primary" fullWidth={false} onClick={connect}>
            {t("connectToChat")}
          </Button>
        </div>
      </div>
    );
  }

  if (!peerAddress) {
    return (
      <div
        className={`card border border-white/[0.08] p-5 ${vsPanelPageShell(embedded)}`}
      >
        <div className="flex min-w-0 gap-3 sm:gap-3.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
            aria-hidden
          >
            <MessageCircle size={16} strokeWidth={2} />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
              {panelTitle}
            </h3>
            <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
              {t("participantOnly")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`card overflow-hidden rounded-xl border border-white/[0.1] p-0 ${vsPanelPageShell(embedded)}`}
    >
      <div className="border-b border-white/[0.08] bg-pv-bg/25 px-5 py-3.5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3 sm:gap-3.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
              aria-hidden
            >
              <MessageCircle size={16} strokeWidth={2} />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                {panelTitle}
              </h3>
              <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                {t("withPeer", { address: shortenAddress(peerAddress) })}
              </p>
            </div>
          </div>
          {innerReady && (
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth={false}
                disabled={!hasMyVisibleToClear}
                onClick={handleClearMyMessages}
                className="text-pv-muted hover:bg-white/[0.04] hover:text-pv-text disabled:opacity-40"
                aria-label={t("clearMyMessagesAria")}
                title={t("clearMyMessagesAria")}
              >
                <Trash2 size={16} aria-hidden />
                <span className="hidden sm:inline">{t("clearMyMessages")}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fullWidth={false}
                disabled={isRefreshing}
                onClick={() => void refreshThread()}
                className="shrink-0 text-pv-muted hover:bg-white/[0.04] hover:text-pv-text"
                aria-busy={isRefreshing}
              >
                <RefreshCw
                  size={16}
                  className={isRefreshing ? "animate-spin" : undefined}
                  aria-hidden
                />
                {isRefreshing ? t("syncingMessages") : t("refreshThread")}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4 sm:px-6 sm:py-5">
      {isXmtpBoot && (
        <p className="text-xs text-pv-muted animate-pulse">{t("initializingXmtp")}</p>
      )}

      {isBlockedByTab && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-300 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <MonitorSmartphone size={14} aria-hidden />
            <span className="font-semibold">{t("blockedByTabTitle")}</span>
          </div>
          <p className="text-amber-300/80">{t("blockedByTabDesc")}</p>
        </div>
      )}

      {isXmtpProviderError && (
        <div
          role="alert"
          className="mb-3 overflow-hidden rounded-xl border border-pv-danger/30 bg-pv-danger/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
        >
          <div className="border-b border-white/[0.06] bg-pv-bg/25 px-3.5 py-2.5 sm:px-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-danger/90">
              {t("providerErrorEyebrow")}
            </p>
          </div>
          <div className="px-3.5 py-3 sm:px-4 sm:py-3.5">
            <p className="text-xs leading-relaxed text-pv-text/90 [overflow-wrap:anywhere]">
              {xmtpProviderErrorMessage || t("errorGeneric")}
            </p>
            {showInboxToolsForInstallLimit ? (
              <div className="mt-4 rounded-lg border border-white/[0.1] bg-pv-bg/40 px-3 py-2.5 sm:px-3.5 sm:py-3">
                <div className="flex flex-row items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-pv-muted">
                    {t("installationsLimitGuide")}
                  </p>
                  <a
                    href={XMTP_INBOX_TOOLS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-pv-muted transition-[border-color,background-color,color] hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-pv-text/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 whitespace-nowrap"
                  >
                    <ExternalLink size={12} className="shrink-0 opacity-70" aria-hidden />
                    {t("openInboxTools")}
                  </a>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                retry();
                clearThreadError();
              }}
              className="mt-3 text-left text-xs font-semibold text-pv-emerald hover:underline"
            >
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {!isXmtpProviderError && innerLoading && (
        <div
          className="space-y-2.5"
          role="status"
          aria-live="polite"
          aria-label={t("loadingConversation")}
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-pv-muted/80">
            {t("loadingConversation")}
          </p>
          <div className="flex flex-col gap-2.5 rounded-lg border border-white/[0.08] bg-pv-bg/35 p-3.5">
            <div className="h-3.5 w-[68%] max-w-[220px] animate-pulse rounded-lg bg-white/[0.07]" />
            <div className="ml-auto h-3.5 w-[52%] max-w-[160px] animate-pulse rounded-lg bg-pv-emerald/15" />
            <div className="h-3.5 w-[58%] max-w-[180px] animate-pulse rounded-lg bg-white/[0.06]" />
          </div>
        </div>
      )}

      {!isXmtpProviderError &&
        innerThreadError &&
        threadErrorLabel &&
        showPeerUnreachablePreview && (
          <div className="mb-3 space-y-3">
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5 sm:px-3.5 sm:py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/85">
                {t("chatPreviewEyebrow")}
              </p>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-pv-muted">
                  {t("chatPreviewBanner")}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    retryOpenThread();
                    setSendError(null);
                    setPendingSends([]);
                  }}
                  className="shrink-0 text-left text-xs font-semibold text-pv-emerald hover:underline sm:text-right"
                >
                  {t("retry")}
                </button>
              </div>
            </div>
            <VsXmtpChatPreviewShell
              peerShort={shortenAddress(peerAddress)}
              viewerShort={shortenAddress(address)}
            />
          </div>
        )}

      {!isXmtpProviderError &&
        innerThreadError &&
        threadErrorLabel &&
        !showPeerUnreachablePreview && (
          <div className="rounded-lg border border-pv-danger/25 bg-pv-danger/[0.06] px-3 py-2 text-xs text-pv-danger mb-3">
            <p>{threadErrorLabel}</p>
            <button
              type="button"
              onClick={() => {
                retryOpenThread();
                setSendError(null);
                setPendingSends([]);
              }}
              className="mt-2 text-pv-emerald font-semibold hover:underline"
            >
              {t("retry")}
            </button>
          </div>
        )}

      {!isXmtpProviderError && innerReady && dm && client && (
        <>
          <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-pv-bg/40">
            <div
              ref={threadScrollRef}
              className={VS_XMTP_PANEL_THREAD_SCROLL_CLASS}
              role="log"
              aria-label={t("chatScrollAria")}
              aria-live="polite"
              aria-relevant="additions"
            >
              {displayRows.length === 0 ? (
                <div className="flex min-h-[112px] flex-col items-center justify-center gap-2.5 px-3 py-7 text-center sm:min-h-[128px]">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-pv-bg/30 text-pv-emerald/80"
                    aria-hidden
                  >
                    <MessageCircle size={18} strokeWidth={1.75} />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-pv-text/85">
                      {t("emptyThread")}
                    </p>
                    <p className="mx-auto max-w-[240px] text-[10px] leading-relaxed text-pv-muted/70">
                      {t("emptyThreadHint")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {displayRows.map((row) => {
                    if (row.kind === "decoded") {
                      const m = row.message;
                      const mine =
                        Boolean(client.inboxId) &&
                        m.senderInboxId === client.inboxId;
                      const peerShort = shortenAddress(peerAddress);
                      const label = mine ? t("messageFromYou") : peerShort;
                      return (
                        <div
                          key={m.id}
                          className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[min(92%,20rem)] rounded-lg px-3 py-2 ${
                              mine
                                ? "border border-pv-emerald/20 bg-pv-emerald/[0.08] text-pv-text"
                                : "border border-white/[0.07] bg-pv-surface2/90 text-pv-text/90"
                            }`}
                          >
                            <p
                              className={`mb-1 text-[10px] tabular-nums text-pv-muted/80 ${
                                mine ? "text-right" : "text-left"
                              }`}
                            >
                              <span className="font-mono">{label}</span>
                              <span className="mx-1 opacity-40" aria-hidden>
                                ·
                              </span>
                              <time dateTime={m.sentAt.toISOString()}>
                                {formatMessageTime(m.sentAt, locale)}
                              </time>
                            </p>
                            <p className="text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                              {getDecodedMessageText(m)}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    const { pending } = row;
                    return (
                      <div
                        key={pending.clientTempId}
                        className="flex w-full justify-end"
                        aria-live="polite"
                      >
                        <div className="max-w-[min(92%,20rem)] rounded-lg border border-transparent bg-pv-emerald/[0.06] px-3 py-2 text-pv-text">
                          <p className="mb-1 text-right text-[10px] tabular-nums text-pv-muted/80">
                            <span className="font-mono">{t("messageFromYou")}</span>
                            <span className="mx-1 opacity-40" aria-hidden>
                              ·
                            </span>
                            <time dateTime={pending.sentAt.toISOString()}>
                              {formatMessageTime(pending.sentAt, locale)}
                            </time>
                          </p>
                          <p className="text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {pending.text}
                          </p>
                          <p className="mt-1.5 text-[10px] text-pv-muted/75">
                            {pending.status === "sending"
                              ? t("sendingMessage")
                              : t("messageQueued")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-pv-bg/[0.08] px-3 pb-2.5 pt-1.5 sm:px-3.5 sm:pb-3 sm:pt-2">
              {sendError ? (
                <p className="mb-2 text-[11px] text-pv-danger" role="alert">
                  {sendError}
                </p>
              ) : null}
              <div className="flex w-full min-w-0 items-center gap-2 sm:gap-2.5">
                <div className="min-w-0 flex-1 [&_input]:w-full">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("placeholderInput")}
                    className="h-[46px] rounded-lg border-white/[0.08] bg-pv-bg/35 text-[13px] placeholder:text-pv-muted/45 focus-visible:border-pv-emerald/25"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="primary"
                  fullWidth={false}
                  className="h-[46px] shrink-0 px-5 !py-0 text-[13px] font-semibold sm:min-w-[5.25rem]"
                  disabled={!draft.trim()}
                  onClick={() => void handleSend()}
                >
                  {t("send")}
                </Button>
              </div>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-pv-muted/55">
            <Lock
              size={11}
              className="mt-0.5 shrink-0 opacity-60"
              aria-hidden
            />
            <span>{t("disclaimer")}</span>
          </p>
        </>
      )}
      </div>
    </div>
  );
}
