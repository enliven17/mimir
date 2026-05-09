/**
 * XMTP limita instalaciones por inbox; el SDK suele devolver un mensaje largo en inglés.
 * @see https://xmtp.chat/inbox-tools
 */

export const XMTP_INBOX_TOOLS_URL = "https://xmtp.chat/inbox-tools" as const;

/** True si el mensaje corresponde al tope de instalaciones (p. ej. 10/10). */
export function isXmtpInstallationsLimitError(
  message: string | null | undefined
): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("10/10") && m.includes("installation")) return true;
  if (m.includes("revoke existing installations")) return true;
  if (/registered\s+\d+\/\d+\s+installations/i.test(message)) return true;
  return false;
}
