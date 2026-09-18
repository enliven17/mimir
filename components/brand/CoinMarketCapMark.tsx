"use client";

/**
 * CoinMarketCap attribution mark.
 *
 * The logo file is not vendored here. It is CoinMarketCap's trademark, their
 * brand pages were not reachable to fetch the official asset, and drawing an
 * approximation of somebody's logo is worse than not showing one. So this
 * renders the real asset when it is present and falls back to the wordmark when
 * it is not, which means the attribution is correct either way.
 *
 * To enable the logo: download the official mark from CoinMarketCap's brand
 * assets and save it as `public/brand/coinmarketcap.svg`. Nothing else changes.
 */

import { useState } from "react";

interface CoinMarketCapMarkProps {
  /** Rendered height in pixels. The width follows the asset's aspect ratio. */
  height?: number;
  className?: string;
  /** Wraps the mark in a link to coinmarketcap.com. */
  linked?: boolean;
}

const LOGO_SRC = "/brand/coinmarketcap.svg";

export default function CoinMarketCapMark({
  height = 16,
  className = "",
  linked = true,
}: CoinMarketCapMarkProps) {
  const [assetMissing, setAssetMissing] = useState(false);

  const mark = assetMissing ? (
    <span className="font-semibold">CoinMarketCap</span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt="CoinMarketCap"
      height={height}
      style={{ height }}
      className="w-auto"
      onError={() => setAssetMissing(true)}
    />
  );

  if (!linked) return <span className={`inline-flex items-center ${className}`}>{mark}</span>;

  return (
    <a
      href="https://coinmarketcap.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center transition-opacity hover:opacity-80 ${className}`}
      aria-label="CoinMarketCap"
    >
      {mark}
    </a>
  );
}
