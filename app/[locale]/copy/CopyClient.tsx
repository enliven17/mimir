"use client";

/**
 * Copy trading: list and revoke your permissions, or grant a new one.
 *
 * The page first asks the API whether the feature is on (a bare GET, no
 * signature), so a deployment with the flag off shows one clear state instead
 * of a form that can only fail after a wallet prompt.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight, PowerOff, Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import CopyPermissionList from "@/components/copy/CopyPermissionList";
import CopyGrantForm from "@/components/copy/CopyGrantForm";
import { useWallet } from "@/lib/wallet";
import { probeCopyTrading } from "@/lib/copy-client";

type Availability = "checking" | "enabled" | "disabled" | "unknown";

export default function CopyClient() {
  const t = useTranslations("copy");
  const { address, isConnected, isConnecting, connect } = useWallet();
  const [availability, setAvailability] = useState<Availability>("checking");

  useEffect(() => {
    let cancelled = false;
    void probeCopyTrading().then((state) => {
      if (!cancelled) setAvailability(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const markDisabled = useCallback(() => setAvailability("disabled"), []);

  let body: ReactNode;
  if (availability === "checking") {
    body = (
      <p role="status" className="text-center font-mono text-xs text-pv-muted">
        {t("checking")}
      </p>
    );
  } else if (availability === "disabled") {
    body = (
      <section
        aria-labelledby="copy-disabled-heading"
        className="rounded-2xl border border-dashed border-white/[0.18] bg-pv-surface px-5 py-10 text-center"
      >
        <PowerOff className="mx-auto size-5 text-pv-muted" aria-hidden />
        <h2 id="copy-disabled-heading" className="mt-3 text-sm font-semibold text-pv-text">
          {t("disabledTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("disabledDesc")}</p>
        <Link
          href="/baskets"
          className="focus-ring mt-4 inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-pv-text underline decoration-pv-emerald underline-offset-4"
        >
          {t("disabledLink")} <ArrowUpRight className="size-3" aria-hidden />
        </Link>
      </section>
    );
  } else if (!isConnected || !address) {
    body = (
      <section
        aria-labelledby="copy-connect-heading"
        className="card mx-auto max-w-md rounded-2xl px-5 py-8 text-center"
      >
        <Wallet className="mx-auto size-6 text-pv-muted" aria-hidden />
        <h2 id="copy-connect-heading" className="mt-4 text-sm font-semibold text-pv-text">
          {t("connectTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-pv-muted">{t("connectDesc")}</p>
        <button
          type="button"
          className="btn-primary focus-ring mt-6"
          onClick={() => void connect()}
          disabled={isConnecting}
        >
          {isConnecting ? t("connecting") : t("connect")}
        </button>
      </section>
    );
  } else {
    // Keyed by wallet so switching accounts never shows one wallet's list under another.
    body = (
      <div className="space-y-6">
        <CopyPermissionList key={`list-${address}`} address={address} onDisabled={markDisabled} />
        <CopyGrantForm key={`grant-${address}`} address={address} onDisabled={markDisabled} />
      </div>
    );
  }

  return (
    <div className="pb-16">
      <BlueprintHeading>{t("title")}</BlueprintHeading>
      <div className="mx-auto max-w-[820px] px-4 pt-6 sm:px-6 lg:px-8">
        <p className="mx-auto max-w-xl text-center text-sm text-pv-muted">{t("intro")}</p>
        <div className="mt-8">{body}</div>
      </div>
    </div>
  );
}
