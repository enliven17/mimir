const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin Turbopack's workspace root. A stray ~/package-lock.json makes Next infer
  // the wrong root (C:\Users\enliven) and serve an empty app dir → every route
  // 404s. Anchoring to this file's dir fixes dev and prod builds alike.
  turbopack: { root: __dirname },
};

module.exports = withNextIntl(nextConfig);
