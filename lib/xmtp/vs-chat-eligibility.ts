/**
 * Reglas de producto: chat XMTP solo en VS 1v1 aceptado (Paso 5).
 * Sin dependencia de `@xmtp/browser-sdk` (seguro para tests / imports server ligeros).
 */

import type { VSData } from "@/lib/contract";
import { getVSChallengerCount, getVSConfiguredMaxChallengers } from "@/lib/contract";
import { ZERO_ADDRESS } from "@/lib/constants";
import { MOCK_CREATED_VS_ID } from "@/lib/mockVsCreate";
import { SAMPLE_VS } from "@/lib/sampleVs";

/** Ancla en `/vs/[id]` para enlazar desde el hub de mensajes. */
export const VS_XMTP_CHAT_ANCHOR_ID = "proven-xmtp-vs-chat";

/** VS de muestra (ids negativos en `SAMPLE_VS`): excluye hub / networking salvo demo 1v1 en detalle. */
export function isSampleVsIdForXmtp(vsId: number): boolean {
  return vsId < 0 && Object.prototype.hasOwnProperty.call(SAMPLE_VS, vsId);
}

/**
 * Demo `/vs/create?demo=1` → ticket `-4`: apuesta 1v1 local (misma UX de panel que un VS real).
 */
export function isOneVsOneDemoVs(vs: VSData): boolean {
  return vs.id === MOCK_CREATED_VS_ID && getVSConfiguredMaxChallengers(vs) === 1;
}

/** Montar `VsXmtpPanel` en `/vs/[id]`: on-chain o demo 1v1 (-4). */
export function shouldMountVsXmtpPanelOnDetailPage(vs: VSData): boolean {
  return vs.id >= 0 || isOneVsOneDemoVs(vs);
}

/**
 * Demo 1v1: si el rival no está en XMTP, mostrar maqueta del hilo (sin envío real).
 * Los VS on-chain siguen con el mensaje de error estándar + Reintentar.
 */
export function shouldShowXmtpPeerUnreachableChatPreview(
  vs: VSData,
  errorKind: string | null | undefined
): boolean {
  return isOneVsOneDemoVs(vs) && errorKind === "peer_unreachable";
}

/** Motivo por el que aún no hay chat XMTP en este VS (para copy en UI). */
export type VsXmtpChatUnavailableReason =
  | "sample"
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
  if (isSampleVsIdForXmtp(vs.id) && !isOneVsOneDemoVs(vs)) return "sample";
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
