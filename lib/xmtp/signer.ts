/**
 * Signer EOA para XMTP usando un proveedor EIP-1193 (`window.ethereum`).
 *
 * **Solo importar desde componentes cliente** (`"use client"`). Este módulo depende de
 * `@xmtp/browser-sdk` (WASM / workers) y no debe cargarse en el servidor.
 *
 * Patrón alineado con la documentación oficial:
 * https://docs.xmtp.org/chat-apps/core-messaging/create-a-signer
 */

import {
  IdentifierKind,
  type Identifier,
  type Signer,
} from "@xmtp/browser-sdk";

/** Proveedor mínimo EIP-1193 (MetaMask, Rabby, wallet GenLayer inyectada, etc.). */
export type EthereumEip1193Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
};

export type XmtpSignerErrorCode =
  | "rejected"
  | "invalid_address"
  | "invalid_signature"
  | "unknown";

export class XmtpSignerError extends Error {
  constructor(
    message: string,
    public readonly code: XmtpSignerErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "XmtpSignerError";
  }
}

function assertHexAddress(address: string): asserts address is `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    throw new XmtpSignerError("Invalid Ethereum address", "invalid_address");
  }
}

/** Codifica un string UTF-8 como `0x…` para `personal_sign` (DATA hex). */
export function utf8MessageToHexData(message: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  const hex = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return `0x${hex}`;
}

/** Convierte firma `0x…` (65 bytes típicos) a `Uint8Array` para el SDK XMTP. */
export function hexSignatureToUint8Array(hex: string): Uint8Array {
  const s = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/i.test(s) || s.length % 2 !== 0) {
    throw new XmtpSignerError("Invalid signature hex", "invalid_signature");
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function mapProviderError(err: unknown): never {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) {
    throw new XmtpSignerError("User rejected the signature request", "rejected", err);
  }
  throw new XmtpSignerError(
    e?.message ?? "Wallet signing failed",
    "unknown",
    err
  );
}

/**
 * Crea un `Signer` XMTP tipo EOA a partir de la wallet inyectada.
 *
 * @param provider - Típicamente `(window as unknown as { ethereum }).ethereum`
 * @param address - Cuenta conectada (0x + 40 hex)
 */
export function createXmtpSignerFromEthereum(
  provider: EthereumEip1193Provider,
  address: string
): Signer {
  const normalized = address.trim() as `0x${string}`;
  assertHexAddress(normalized);

  const identifier: Identifier = {
    identifier: normalized.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  };

  const signer: Signer = {
    type: "EOA",
    getIdentifier: () => identifier,
    signMessage: async (message: string) => {
      const data = utf8MessageToHexData(message);
      try {
        const sig = await provider.request({
          method: "personal_sign",
          params: [data, normalized],
        });
        if (typeof sig !== "string") {
          throw new XmtpSignerError(
            "Wallet returned non-string signature",
            "invalid_signature"
          );
        }
        return hexSignatureToUint8Array(sig);
      } catch (err) {
        if (err instanceof XmtpSignerError) throw err;
        mapProviderError(err);
      }
    },
  };

  return signer;
}
