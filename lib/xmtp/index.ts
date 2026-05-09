/**
 * Barrel **seguro para cualquier contexto** (solo reexporta config sin `@xmtp/browser-sdk`).
 *
 * El **signer** vive en `./signer` — importarlo solo desde `"use client"`:
 * `import { createXmtpSignerFromEthereum } from "@/lib/xmtp/signer"`.
 */
export {
  getXmtpAppVersion,
  getXmtpClientCreateOptions,
  getXmtpEnv,
  isXmtpFeatureEnabled,
  type XmtpNetworkEnv,
} from "./config";
