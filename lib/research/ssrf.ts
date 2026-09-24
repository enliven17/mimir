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

/**
 * The eight 16-bit groups of an IPv6 address, or null when it does not parse.
 * Handles `::` compression and a dotted IPv4 tail (`::ffff:1.2.3.4`).
 */
export function ipv6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  let tail: number[] = [];
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (dotted) {
    const b = dotted.slice(1).map(Number);
    if (b.some((n) => n > 255)) return null;
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    s = s.slice(0, -dotted[0].length);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const groups = [...head, ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const explicit = groups.length + tail.length;
  if (halves.length === 1 ? explicit !== 8 : explicit > 7) return null;
  const zeros = new Array(8 - explicit).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...(halves.length === 2 ? zeros : []), ...rest.map((g) => parseInt(g, 16)), ...tail];
}

function embeddedIpv4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPrivateIpv6(ip: string): boolean {
  const h = ipv6Hextets(ip);
  // Fail closed: something that looked like IPv6 but does not parse is refused.
  if (!h) return true;
  const zeroUpTo = (n: number) => h.slice(0, n).every((x) => x === 0);

  if (zeroUpTo(8)) return true; // ::
  if (zeroUpTo(7) && h[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:7f00:1) and the deprecated
  // IPv4-compatible form (::a.b.c.d) inherit the IPv4 verdict.
  if (zeroUpTo(5) && h[5] === 0xffff) return isPrivateIpv4(embeddedIpv4(h[6], h[7]));
  if (zeroUpTo(6)) return isPrivateIpv4(embeddedIpv4(h[6], h[7]));
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 destination.
  if (h[0] === 0x64 && h[1] === 0xff9b) return h[2] !== 0 || isPrivateIpv4(embeddedIpv4(h[6], h[7]));
  if (h[0] === 0x2002) return isPrivateIpv4(embeddedIpv4(h[1], h[2]));
  if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo tunnels to arbitrary IPv4
  if (h[0] === 0x100 && zeroUpTo(4)) return true; // discard-only
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
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
