/**
 * Utilidades de hilo DM (cliente XMTP) — Paso 6: sync global, consentimiento, mensajes.
 * Solo importar desde `"use client"` o hooks.
 */

import {
  Client,
  ConsentState,
  IdentifierKind,
  type DecodedMessage,
  type Dm,
  type Identifier,
  type XmtpEnv,
} from "@xmtp/browser-sdk";
import { getXmtpEnv } from "@/lib/xmtp/config";
import type { XmtpClientInstance } from "@/lib/xmtp/types";

/** Límite de historial por carga / refresco (BigInt por API del SDK). */
export const XMTP_THREAD_MESSAGE_LIMIT = BigInt(40);

export class XmtpPeerUnreachableError extends Error {
  readonly code = "XMTP_PEER_UNREACHABLE" as const;

  constructor() {
    super("XMTP_PEER_UNREACHABLE");
    this.name = "XmtpPeerUnreachableError";
  }
}

export type XmtpThreadErrorKind =
  | "peer_unreachable"
  | "rate_limit"
  | "network"
  | "unknown";

export function peerIdentifierFromAddress(address: string): Identifier {
  return {
    identifier: address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  };
}

export function sortDecodedMessagesBySentAt(
  list: DecodedMessage[]
): DecodedMessage[] {
  return [...list].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

/** Texto legible de un mensaje decodificado (prioriza contenido de texto). */
export function getDecodedMessageText(m: DecodedMessage): string {
  const c = m.content;
  if (typeof c === "string") return c;
  if (c != null && typeof c === "object" && "text" in c) {
    const t = (c as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return m.fallback?.trim() || "…";
}

export function classifyXmtpThreadError(err: unknown): {
  kind: XmtpThreadErrorKind;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    err instanceof XmtpPeerUnreachableError ||
    message === "XMTP_PEER_UNREACHABLE"
  ) {
    return { kind: "peer_unreachable", message };
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return { kind: "rate_limit", message };
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("econnreset")
  ) {
    return { kind: "network", message };
  }
  return { kind: "unknown", message };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`${label}_TIMEOUT`));
      }, timeoutMs);
    }),
  ]);
}

/**
 * Sincroniza conversaciones permitidas, abre o crea el DM 1v1, ajusta consent
 * si sigue en `Unknown`, sincroniza el hilo y devuelve mensajes ordenados.
 */
export async function ensureVsDmThread(
  client: XmtpClientInstance,
  peerAddress: string,
  { timeoutMs = 20000 }: { timeoutMs?: number } = {}
): Promise<{ dm: Dm; messages: DecodedMessage[] }> {
  const id = peerIdentifierFromAddress(peerAddress);

  await withTimeout(
    client.conversations.syncAll([ConsentState.Allowed]),
    timeoutMs,
    "XMTP_SYNC_ALL"
  );

  let conversation = await withTimeout(
    client.conversations.fetchDmByIdentifier(id),
    timeoutMs,
    "XMTP_FETCH_DM"
  );

  if (!conversation) {
    const env = client.env ?? (getXmtpEnv() as XmtpEnv);
    const canMap = await withTimeout(
      Client.canMessage([id], env),
      timeoutMs,
      "XMTP_CAN_MESSAGE"
    );
    const can =
      canMap.get(id.identifier) ??
      Array.from(canMap.values()).some(Boolean);
    if (!can) {
      throw new XmtpPeerUnreachableError();
    }
    conversation = await withTimeout(
      client.conversations.createDmWithIdentifier(id),
      timeoutMs,
      "XMTP_CREATE_DM"
    );
  }

  const consent = await withTimeout(
    conversation.consentState(),
    timeoutMs,
    "XMTP_CONSENT_STATE"
  );
  if (consent === ConsentState.Unknown) {
    await withTimeout(
      conversation.updateConsentState(ConsentState.Allowed),
      timeoutMs,
      "XMTP_UPDATE_CONSENT"
    );
  }

  await withTimeout(conversation.sync(), timeoutMs, "XMTP_DM_SYNC");

  const raw = await withTimeout(
    conversation.messages({
      limit: XMTP_THREAD_MESSAGE_LIMIT,
    }),
    timeoutMs,
    "XMTP_MESSAGES"
  );
  const messages = sortDecodedMessagesBySentAt(raw);

  return { dm: conversation, messages };
}

/** Recarga mensajes tras `sync` (mismo orden y límite que la apertura). */
export async function loadThreadMessages(dm: Dm): Promise<DecodedMessage[]> {
  const raw = await dm.messages({ limit: XMTP_THREAD_MESSAGE_LIMIT });
  return sortDecodedMessagesBySentAt(raw);
}
