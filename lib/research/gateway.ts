/**
 * The only way agent code reaches an arbitrary URL.
 *
 * Node-only (it resolves DNS itself), but deliberately not marked `server-only`:
 * the agent workers import it outside the Next runtime.
 *
 * Three things `fetch` does not do on its own:
 *
 *  1. It follows redirects itself, so a public host can bounce the request to
 *     loopback and the caller never sees the hop. Redirects are followed
 *     manually here and every hop is validated again.
 *  2. It resolves DNS invisibly, so a public name pointing at a private address
 *     passes a name-only check. Each hop's host is resolved and the addresses
 *     are checked.
 *  3. It will happily stream a response of any size. The body is read with a
 *     hard byte ceiling, so a slow multi-gigabyte source cannot exhaust the
 *     worker.
 */
import { lookup } from "node:dns/promises";

import { checkResolvedAddresses, checkUrl, type UrlRejection } from "./ssrf";

export const MAX_REDIRECTS = 3;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;

export class GatewayRejectedError extends Error {
  constructor(
    message: string,
    readonly reason: UrlRejection["reason"] | "too_many_redirects" | "response_too_large",
    readonly url: string,
  ) {
    super(message);
    this.name = "GatewayRejectedError";
  }
}

/** Throws GatewayRejectedError unless the URL and everything it resolves to are public. */
export async function assertHopAllowed(rawUrl: string): Promise<URL> {
  const rejection = checkUrl(rawUrl);
  if (rejection) throw new GatewayRejectedError(rejection.message, rejection.reason, rawUrl);

  const url = new URL(rawUrl);
  let addresses: string[] = [];
  try {
    const resolved = await lookup(url.hostname, { all: true });
    addresses = resolved.map((r) => r.address);
  } catch {
    throw new GatewayRejectedError("hostname did not resolve", "private_host", rawUrl);
  }
  const addressRejection = checkResolvedAddresses(addresses);
  if (addressRejection) {
    throw new GatewayRejectedError(addressRejection.message, addressRejection.reason, rawUrl);
  }
  return url;
}

export interface GatewayResponse {
  body: string;
  status: number;
  contentType: string;
  /** Where the chain of redirects actually ended. */
  finalUrl: string;
  truncated: boolean;
}

export interface GatewayFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

/**
 * Fetch a URL with every hop checked.
 *
 * Non-2xx responses come back rather than throwing: a 402 is how a paywalled
 * source announces itself, and a 404 is evidence about the source, not a
 * gateway failure. Only a refused hop or an oversized body throws.
 */
export async function gatewayFetch(
  rawUrl: string,
  options: GatewayFetchOptions = {},
): Promise<GatewayResponse> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertHopAllowed(current);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: options.headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          body: "",
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          finalUrl: url.toString(),
          truncated: false,
        };
      }
      // Relative locations are resolved against the hop that issued them.
      current = new URL(location, url).toString();
      continue;
    }

    const { text, truncated } = await readCapped(response, maxBytes);
    return {
      body: text,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: url.toString(),
      truncated,
    };
  }

  throw new GatewayRejectedError(
    `more than ${maxRedirects} redirects`,
    "too_many_redirects",
    rawUrl,
  );
}

/** Read a response body up to a byte ceiling, then stop pulling. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    // Do not even start: the source told us it is too big.
    void response.body?.cancel();
    return { text: "", truncated: true };
  }

  const reader = response.body?.getReader();
  if (!reader) return { text: await response.text(), truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      truncated = true;
      void reader.cancel();
      break;
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged.slice(0, maxBytes)), truncated };
}
