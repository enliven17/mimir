/**
 * SSRF guard for outbound fetches of attacker-controlled URLs.
 *
 * Claim `resolutionUrl` comes from permissionless on-chain calldata, so an
 * attacker can point it at internal services, cloud metadata (169.254.169.254),
 * or localhost. We resolve the host and refuse any non-public address before
 * fetching, and re-check on every redirect hop.
 *
 * ponytail: DNS is resolved once here; a rebinding attacker could return a
 * public IP now and a private one at connect time (TOCTOU). Closing that fully
 * means pinning the resolved IP and dialing it directly — upgrade path if this
 * ever guards higher-value calls. For now this blocks the direct cases.
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                       // "this" network
  if (a === 10) return true;                      // private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;        // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                       // multicast / reserved
  return false;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;    // loopback / unspecified
    if (v.startsWith("fe80")) return true;         // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local
    const mapped = v.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
  }
  return true; // unrecognised → unsafe
}

/** Throws SsrfBlockedError if the URL's host resolves to any non-public IP. */
export async function assertPublicUrl(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new SsrfBlockedError(`Blocked non-public address: ${host}`);
    return;
  }

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for ${host}`);
  }
  if (addrs.length === 0) throw new SsrfBlockedError(`No addresses for ${host}`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new SsrfBlockedError(`Blocked non-public address: ${host} → ${a.address}`);
    }
  }
}

// demo(): private ranges blocked, public allowed.
if (process.argv[1]?.endsWith("ssrf-guard.ts")) {
  const blocked = ["127.0.0.1", "169.254.169.254", "10.1.2.3", "192.168.0.1", "172.16.5.5", "::1", "::ffff:127.0.0.1"];
  const ok = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"];
  for (const ip of blocked) if (!isPrivateIp(ip)) throw new Error(`should block ${ip}`);
  for (const ip of ok) if (isPrivateIp(ip)) throw new Error(`should allow ${ip}`);
  console.log("ssrf-guard self-check OK");
}
