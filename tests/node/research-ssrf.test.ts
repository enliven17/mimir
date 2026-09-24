import test from "node:test";
import assert from "node:assert/strict";

import {
  checkUrl,
  checkResolvedAddresses,
  isPrivateIpv4,
  isPrivateIpv6,
  isPrivateHostname,
  ALLOWED_PORTS,
} from "../../lib/research/ssrf";

test("private and reserved IPv4 ranges are refused", () => {
  const priv = [
    "10.0.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254", // cloud instance metadata
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ];
  for (const ip of priv) assert.equal(isPrivateIpv4(ip), true, ip);

  const publicIps = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "93.184.216.34"];
  for (const ip of publicIps) assert.equal(isPrivateIpv4(ip), false, ip);
});

test("malformed IPv4 input is not treated as private by accident", () => {
  for (const junk of ["not.an.ip.at", "10.0.0", "10.0.0.1.1", ""]) {
    assert.equal(isPrivateIpv4(junk), false, junk);
  }
});

test("private IPv6 ranges, including IPv4-mapped loopback, are refused", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateIpv6(ip), true, ip);
  }
  assert.equal(isPrivateIpv6("2606:4700:4700::1111"), false);
  assert.equal(isPrivateIpv6("::ffff:8.8.8.8"), false);
});

test("hostnames that never need DNS are refused by name", () => {
  for (const host of [
    "localhost",
    "api.localhost",
    "printer.local",
    "metadata.google.internal",
    "db.home.arpa",
    "127.0.0.1",
    "[::1]".replace(/[[\]]/g, ""),
  ]) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.equal(isPrivateHostname("example.com"), false);
  assert.equal(isPrivateHostname("EXAMPLE.COM."), false);
});

test("only http and https are fetchable", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com"]) {
    assert.equal(checkUrl(url)?.reason, "protocol", url);
  }
  assert.equal(checkUrl("https://example.com/x"), null);
  assert.equal(checkUrl("http://example.com/x"), null);
});

test("junk that is not an absolute URL is refused", () => {
  assert.equal(checkUrl("/relative/path")?.reason, "bad_url");
  assert.equal(checkUrl("")?.reason, "bad_url");
});

test("embedded credentials are refused", () => {
  assert.equal(checkUrl("https://user:pass@example.com/")?.reason, "credentials");
  assert.equal(checkUrl("https://user@example.com/")?.reason, "credentials");
});

test("only the allowed ports pass", () => {
  for (const port of ALLOWED_PORTS) {
    assert.equal(checkUrl(`https://example.com:${port}/x`), null, String(port));
  }
  assert.equal(checkUrl("http://example.com:22/")?.reason, "port");
  assert.equal(checkUrl("http://example.com:6379/")?.reason, "port");
});

test("a URL pointing straight at a private host is refused before DNS", () => {
  assert.equal(checkUrl("http://169.254.169.254/latest/meta-data/")?.reason, "private_host");
  assert.equal(checkUrl("http://localhost:8080/admin")?.reason, "private_host");
});

test("a public name resolving to a private address is still refused", () => {
  assert.equal(checkUrl("https://evidence.example.com/x"), null, "the name itself looks fine");
  assert.equal(checkResolvedAddresses(["127.0.0.1"])?.reason, "private_address");
  assert.equal(checkResolvedAddresses(["93.184.216.34", "10.0.0.5"])?.reason, "private_address");
  assert.equal(checkResolvedAddresses(["93.184.216.34"]), null);
});

test("a hostname that resolves to nothing is refused", () => {
  assert.equal(checkResolvedAddresses([])?.reason, "private_host");
});

test("IPv6 spellings that smuggle a private IPv4 destination are refused", () => {
  for (const ip of [
    "::ffff:7f00:1", // ::ffff:127.0.0.1 as WHATWG URL normalises it
    "[::ffff:a9fe:a9fe]", // 169.254.169.254
    "::ffff:0a00:0001",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe", // NAT64 to metadata
    "64:ff9b::127.0.0.1",
    "2002:7f00:0001::1", // 6to4 of 127.0.0.1
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "fe80::1%eth0",
    "not:an:ip:::",
  ]) {
    assert.equal(isPrivateIpv6(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "64:ff9b::808:808", "2002:0808:0808::1", "::ffff:808:808"]) {
    assert.equal(isPrivateIpv6(ip), false, ip);
  }
  // What `new URL()` actually hands the hostname check.
  assert.equal(checkUrl("http://[::ffff:127.0.0.1]/")?.reason, "private_host");
  assert.equal(checkUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/")?.reason, "private_host");
});

test("the socket-level lookup refuses private answers", async () => {
  const { publicOnlyLookup } = await import("../../lib/research/gateway");
  const err = await new Promise<unknown>((resolve) =>
    publicOnlyLookup("localhost", {}, (e) => resolve(e)),
  );
  assert.ok(err instanceof Error && /non-public/.test(err.message));
});
