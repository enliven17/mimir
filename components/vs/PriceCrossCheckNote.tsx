"use client";

/**
 * Attribution for the second price source, shown where it is actually used.
 *
 * CoinMarketCap is not the resolution source: the claim's own linked page is.
 * CoinMarketCap is the independent reading the oracle checks that page against
 * before settling. Putting "provided by CoinMarketCap" next to the source link
 * would say the wrong thing, so this states what the data is really for and
 * appears only on the claims where the cross-check runs at all.
 */

import { ShieldCheck } from "lucide-react";

import { priceCheckTarget } from "@/lib/price-consensus";

export default function PriceCrossCheckNote({
  question,
  settlementRule,
  className = "",
}: {
  question: string;
  settlementRule?: string;
  className?: string;
}) {
  const target = priceCheckTarget(question, settlementRule ?? "");
  if (!target) return null;

  return (
    <p
      className={`flex flex-wrap items-center gap-1.5 text-[10px] text-pv-muted ${className}`}
      title={`Before settling, the ${target.symbol} price is read from two independent sources and compared against the $${target.threshold.toLocaleString("en-US")} threshold.`}
    >
      <ShieldCheck size={10} aria-hidden />
      <span>
        {target.symbol} price cross-checked against{" "}
        <a
          href="https://coinmarketcap.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-pv-cyan"
        >
          CoinMarketCap
        </a>
        . Sources that disagree refund instead of settling.
      </span>
    </p>
  );
}
