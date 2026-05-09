import { Client } from "@xmtp/browser-sdk";

/**
 * Instancia devuelta por `Client.create` (codecs por defecto del SDK v7).
 * Centralizado para provider, hooks y utilidades de hilo.
 */
export type XmtpClientInstance = Awaited<ReturnType<typeof Client.create>>;
