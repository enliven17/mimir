/**
 * SSRF guards for agent-supplied URLs.
 *
 * A claim's resolution URL is chosen by whoever created the claim, and the
 * oracle fetches it from inside our infrastructure. Without these checks a
 * market whose "evidence source" is `http://169.254.169.254/latest/meta-data/`
 * turns the oracle into a proxy for reading cloud instance credentials.
 *
 * Pure predicates live here so they can be tested without a network.
 */

export const ALLOWED_PROTOCOLS = ["http:", "https:"];

/** Ports outside this set are refused: nothing legitimate serves evidence on 22. */
export const ALLOWED_PORTS = [80, 443, 8080, 8443];

export interface UrlRejection {
  reason:
    | "bad_url"
    | "protocol"
    | "port"
    | "credentials"
    | "private_host"
    | "private_address";
  message: string;
}

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((p) => Number(p));
  if (parts.some((p) => !/^\d{1,3}$/.test(p)) || [a, b].some((n) => !Number.isFinite(n))) return false;
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 0) return true; // this network
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped (::ffff:127.0.0.1) inherits the IPv4 verdict.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  if (normalized.startsWith("fe80")) return true; // link-local
  if (normalized.startsWith("ff")) return true; // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/** Hostnames that never need a DNS lookup to be refused. */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  // metadata.google.internal is covered by .internal; the AWS/Azure/GCP IPs are
  // covered by the link-local range once resolved.
  if (isPrivateAddress(host)) return true;
  return false;
}

/**
 * Validate one URL, before any DNS lookup. Returns null when the URL is fine.
 *
 * Called for the original URL and again for every redirect target: a host that
 * passes on the first hop can still redirect to loopback on the second.
 */
export function checkUrl(raw: string): UrlRejection | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "bad_url", message: "not a valid absolute URL" };
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return { reason: "protocol", message: `${url.protocol} is not fetchable` };
  }
  if (url.username || url.password) {
    return { reason: "credentials", message: "URLs with embedded credentials are refused" };
  }
  if (url.port && !ALLOWED_PORTS.includes(Number(url.port))) {
    return { reason: "port", message: `port ${url.port} is not allowed` };
  }
  if (isPrivateHostname(url.hostname)) {
    return { reason: "private_host", message: `${url.hostname} is not a public host` };
  }
  return null;
}

/**
 * Validate what a hostname actually resolved to.
 *
 * The name check above is not enough on its own: an attacker controls their own
 * DNS, and `evidence.example.com` can be an A record pointing at 127.0.0.1.
 */
export function checkResolvedAddresses(addresses: string[]): UrlRejection | null {
  if (addresses.length === 0) {
    return { reason: "private_host", message: "hostname did not resolve" };
  }
  const bad = addresses.find(isPrivateAddress);
  if (bad) {
    return { reason: "private_address", message: `resolves to the non-public address ${bad}` };
  }
  return null;
}
