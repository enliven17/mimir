/**
 * Configuración XMTP para el cliente browser (Paso 2).
 *
 * **Solo usar desde componentes cliente** (`"use client"`). No importar `@xmtp/browser-sdk`
 * en Server Components.
 *
 * Opciones alineadas con la doc oficial:
 * https://docs.xmtp.org/chat-apps/core-messaging/create-a-client
 */

export type XmtpNetworkEnv = "local" | "dev" | "production";

const XMTP_ENV_VALUES = new Set<XmtpNetworkEnv>(["local", "dev", "production"]);

function parseXmtpEnv(raw: string | undefined): XmtpNetworkEnv {
  const v = (raw ?? "dev").toLowerCase().trim();
  if (XMTP_ENV_VALUES.has(v as XmtpNetworkEnv)) {
    return v as XmtpNetworkEnv;
  }
  return "dev";
}

/**
 * Entorno de red XMTP (`local` | `dev` | `production`).
 * `NEXT_PUBLIC_XMTP_ENV` — por defecto `dev` (recomendado para desarrollo).
 */
export function getXmtpEnv(): XmtpNetworkEnv {
  return parseXmtpEnv(process.env.NEXT_PUBLIC_XMTP_ENV);
}

/**
 * Activa la UI y flujos XMTP en el cliente. Útil para despliegues graduales.
 * Considera truthy: `1`, `true`, `yes` (case-insensitive).
 */
export function isXmtpFeatureEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_XMTP?.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes";
}

const DEFAULT_APP_VERSION = "proven-app/0.1";

/**
 * Identificador de app para telemetría y soporte XMTP (recomendado en producción).
 * `NEXT_PUBLIC_XMTP_APP_VERSION` — ej. `proven-app/1.0.0`
 */
export function getXmtpAppVersion(): string {
  return (
    process.env.NEXT_PUBLIC_XMTP_APP_VERSION?.trim() || DEFAULT_APP_VERSION
  );
}

/**
 * Segundo argumento de `Client.create(signer, options)` del Browser SDK.
 * No importa `@xmtp/browser-sdk` aquí para mantener este módulo seguro en cualquier contexto.
 */
export function getXmtpClientCreateOptions(): {
  env: XmtpNetworkEnv;
  appVersion: string;
} {
  return {
    env: getXmtpEnv(),
    appVersion: getXmtpAppVersion(),
  };
}
