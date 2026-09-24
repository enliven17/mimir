/**
 * Reglas de producto: chat XMTP solo en VS 1v1 aceptado (Paso 5).
 * Sin dependencia de `@xmtp/browser-sdk` (seguro para tests / imports server ligeros).
 */

import type { VSData } from "@/lib/contract";
import { getVSChallengerCount } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/constants";

/** Ancla en `/vs/[id]` para enlazar desde el hub de mensajes. */
export const VS_XMTP_CHAT_ANCHOR_ID = "proven-xmtp-vs-chat";

/** Montar `VsXmtpPanel` en `/vs/[id]`: solo VS on-chain. */
export function shouldMountVsXmtpPanelOnDetailPage(vs: VSData): boolean {
  return vs.id >= 0;
}

/** Motivo por el que aún no hay chat XMTP en este VS (para copy en UI). */
export type VsXmtpChatUnavailableReason =
  | "not_accepted"
  | "waiting_opponent"
  | "multi_challenger";

/** VS en estado aceptado, con un solo rival y oponente on-chain definido. */
export function canOpenVsXmtpChat(vs: VSData): boolean {
  if (vs.state !== "accepted") return false;
  if (!vs.opponent || vs.opponent === ZERO_ADDRESS) return false;
  if (getVSChallengerCount(vs) !== 1) return false;
  return true;
}

/**
 * Si el chat XMTP no está disponible, devuelve la razón; si está disponible, `null`.
 * No comprueba wallet: solo estado del VS.
 */
export function getVsXmtpUnavailableReason(
  vs: VSData
): VsXmtpChatUnavailableReason | null {
  if (canOpenVsXmtpChat(vs)) return null;
  if (getVSChallengerCount(vs) > 1) return "multi_challenger";
  if (vs.state !== "accepted") return "not_accepted";
  if (!vs.opponent || vs.opponent === ZERO_ADDRESS) return "waiting_opponent";
  return "not_accepted";
}

/**
 * Dirección de la contraparte en XMTP (la otra parte del 1v1).
 * `viewer` debe ser creator u opponent (comparación case-insensitive).
 */
export function getVsXmtpPeerAddress(
  vs: VSData,
  viewerAddress: string | null | undefined
): string | null {
  if (!viewerAddress || !canOpenVsXmtpChat(vs)) return null;
  const v = viewerAddress.toLowerCase();
  const c = vs.creator.toLowerCase();
  const o = vs.opponent.toLowerCase();
  if (v === c) return vs.opponent;
  if (v === o) return vs.creator;
  return null;
}
