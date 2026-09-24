const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Baseline security headers. No full CSP: the wallet connectors, WalletConnect
 * and the XMTP WASM worker load from origins that change per wallet, and a CSP
 * that breaks connecting is worse than none. `frame-ancestors` alone blocks
 * clickjacking of the stake and sign prompts.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin Turbopack's workspace root. A stray ~/package-lock.json makes Next infer
  // the wrong root (C:\Users\enliven) and serve an empty app dir → every route
  // 404s. Anchoring to this file's dir fixes dev and prod builds alike.
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

module.exports = withNextIntl(nextConfig);
