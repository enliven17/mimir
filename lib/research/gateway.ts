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
 *     passes a name-only check, and a name checked once can resolve somewhere
 *     else a moment later (DNS rebinding). Requests go through node:http(s)
 *     with a lookup that validates the answer it hands to the socket, so the
 *     address checked is the address dialled.
 *  3. It will happily stream a response of any size. The body is read with a
 *     hard byte ceiling, so a slow multi-gigabyte source cannot exhaust the
 *     worker.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

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

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A socket-level DNS lookup that refuses any private answer. Handed to
 * node:http(s) so the resolution that is validated is the one connected to.
 */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const list = addresses as LookupAddress[];
    const rejection = checkResolvedAddresses(list.map((a) => a.address));
    if (rejection) {
      return callback(new GatewayRejectedError(rejection.message, rejection.reason, hostname) as NodeJS.ErrnoException, "");
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

interface HopResult {
  status: number;
  location: string | undefined;
  contentType: string;
  text: string;
  truncated: boolean;
}

function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip") return res.pipe(createGunzip());
  if (encoding === "br") return res.pipe(createBrotliDecompress());
  if (encoding === "deflate") return res.pipe(createInflate());
  return res;
}

/** One GET, no redirect following, body capped at `maxBytes`. */
function requestOnce(url: URL, headers: Record<string, string> | undefined, timeoutMs: number, maxBytes: number): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...headers },
        lookup: publicOnlyLookup as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const base = {
          status,
          location: typeof res.headers.location === "string" ? res.headers.location : undefined,
          contentType: String(res.headers["content-type"] ?? ""),
        };
        if (status >= 300 && status < 400) {
          res.resume();
          return done(() => resolve({ ...base, text: "", truncated: false }));
        }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          // Do not even start: the source told us it is too big.
          res.destroy();
          return done(() => resolve({ ...base, text: "", truncated: true }));
        }

        const body = decoded(res);
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        const finish = () =>
          done(() => resolve({ ...base, text: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"), truncated }));
        body.on("data", (chunk: Buffer) => {
          total += chunk.length;
          chunks.push(chunk);
          if (total >= maxBytes) {
            truncated = true;
            finish();
            res.destroy();
          }
        });
        body.on("end", finish);
        body.on("error", (err) => (truncated ? finish() : done(() => reject(err))));
      },
    );

    const timer = setTimeout(() => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
    req.on("error", (err) => done(() => reject(err)));
    req.end();
  });
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
    const response = await requestOnce(url, options.headers, timeoutMs, maxBytes);

    if (response.status >= 300 && response.status < 400) {
      if (!response.location) {
        return { body: "", status: response.status, contentType: response.contentType, finalUrl: url.toString(), truncated: false };
      }
      // Relative locations are resolved against the hop that issued them.
      current = new URL(response.location, url).toString();
      continue;
    }

    return {
      body: response.text,
      status: response.status,
      contentType: response.contentType,
      finalUrl: url.toString(),
      truncated: response.truncated,
    };
  }

  throw new GatewayRejectedError(
    `more than ${maxRedirects} redirects`,
    "too_many_redirects",
    rawUrl,
  );
}
