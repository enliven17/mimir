"use client";

/**
 * Post-create success screen for /vs/create: ISSUED seal, share link,
 * social share chips, tx receipts, and create-another / view actions.
 * Extracted from the create page so the form and the receipt don't live
 * in one 2k-line component.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { GlassCard, Button } from "@/components/ui";
import { sealStamp } from "@/lib/animations/rituals";
import { getShareUrl } from "@/lib/constants";
import { getExplorerTxUrl, ARC_EXPLORER_URL } from "@/lib/arc";

export default function CreateSuccessScreen({
  createdId,
  inviteKey,
  pending,
  txHash,
  explorerTxHash,
  isRematch,
  onReset,
}: {
  createdId: number;
  inviteKey: string;
  pending: boolean;
  txHash: string;
  explorerTxHash: string;
  isRematch: boolean;
  onReset: () => void;
}) {
  const t = useTranslations("create");
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  const shareUrl = getShareUrl(createdId, inviteKey);
  const isMockSuccess = createdId < 0;

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <PageTransition>
        <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-4 sm:px-6 sm:pb-12 sm:pt-8 md:max-w-xl">
          <AnimatedItem>
            <div className="space-y-6 sm:space-y-10">
              <header className="text-center">
                {/* Seal stamp — "ISSUED" lock-in animation */}
                <motion.div
                  variants={sealStamp}
                  initial="hidden"
                  animate="visible"
                  className="mx-auto mb-5 inline-flex items-center justify-center rounded-xl border-[3px] border-pv-emerald bg-pv-emerald/[0.05] px-8 py-2 font-display text-lg font-bold uppercase tracking-widest text-pv-emerald shadow-glow-emerald sm:text-xl"
                >
                  ISSUED
                </motion.div>
                <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald/90">
                  {isMockSuccess
                    ? t("mockSuccessBadge")
                    : pending
                      ? t("createSuccessBadgePending")
                      : t("createSuccessBadgeLive")}
                </p>
                <h1 className="font-display text-2xl font-bold tracking-tight text-pv-text sm:text-3xl">
                  {pending
                    ? t("pendingTitle")
                    : isRematch
                      ? t("createSuccessHeadlineRematch")
                      : t("createSuccessHeadline")}
                </h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                  {pending
                    ? t("pendingHint")
                    : inviteKey
                      ? t("sendThisPrivateLink")
                      : t("sendThisLink")}
                </p>
              </header>

              <GlassCard
                glass
                noPad
                glow="none"
                className="!rounded-2xl border border-white/[0.12]"
              >
                <div className="space-y-3 p-5 sm:p-6">
                  <label
                    className="block text-left text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted"
                    htmlFor="create-success-share-url"
                  >
                    {t("inviteLinkLabel")}
                  </label>
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:gap-3">
                    <input
                      id="create-success-share-url"
                      readOnly
                      value={shareUrl}
                      className="form-field-pv min-h-[3rem] flex-1 break-all font-mono text-[11px] leading-snug sm:min-h-0 sm:text-xs"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      fullWidth={false}
                      onClick={copyLink}
                      className="w-full shrink-0 rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[8.5rem]"
                    >
                      {copied ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : (
                        <Copy className="size-4 shrink-0" aria-hidden />
                      )}
                      {copied ? tc("copied") : tc("copy")}
                    </Button>
                  </div>
                </div>
              </GlassCard>

              <div>
                <p className="mb-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-pv-muted/75">
                  {t("shareVia")}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Challenge me on Mimir: ${shareUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-semibold uppercase tracking-wide text-pv-muted transition-colors hover:border-pv-emerald/35 hover:text-pv-emerald"
                  >
                    WhatsApp
                  </a>
                  <a
                    href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="chip inline-flex min-h-[44px] items-center justify-center px-4 text-xs font-semibold uppercase tracking-wide text-pv-muted transition-colors hover:border-pv-emerald/35 hover:text-pv-emerald"
                  >
                    Telegram
                  </a>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-pv-bg/35 px-4 py-3.5 sm:px-5">
                <div className="space-y-2 text-left text-xs text-pv-muted">
                  {isMockSuccess && (
                    <p className="text-[11px] leading-relaxed text-pv-muted/90">
                      {t("mockTxDisclaimer")}
                    </p>
                  )}
                  {(pending || isMockSuccess) && txHash && (
                    <p className="font-mono leading-relaxed">
                      {t("walletTx")}:{" "}
                      {isMockSuccess ? (
                        <span className="text-pv-text/90">
                          {txHash.slice(0, 10)}…
                          {txHash.slice(-8)}
                        </span>
                      ) : (
                        <a
                          href={getExplorerTxUrl(txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pv-emerald underline-offset-2 transition-colors hover:underline"
                        >
                          {txHash.slice(0, 10)}…
                          {txHash.slice(-8)}
                        </a>
                      )}
                    </p>
                  )}
                  {explorerTxHash &&
                    (!pending || explorerTxHash !== txHash) && (
                      <p className="font-mono leading-relaxed">
                        {pending ? t("consensusTx") : "Tx"}:{" "}
                        {isMockSuccess ? (
                          <span className="text-pv-text/90">
                            {explorerTxHash.slice(0, 10)}…
                            {explorerTxHash.slice(-8)}
                          </span>
                        ) : (
                          <a
                            href={getExplorerTxUrl(explorerTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-pv-emerald underline-offset-2 transition-colors hover:underline"
                          >
                            {explorerTxHash.slice(0, 10)}…
                            {explorerTxHash.slice(-8)}
                          </a>
                        )}
                      </p>
                    )}
                  {isMockSuccess ? (
                    <p className="text-[11px] leading-relaxed text-pv-muted/85">
                      {t("mockExplorerNote")}
                    </p>
                  ) : (
                    <p>
                      <a
                        href={ARC_EXPLORER_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-pv-emerald underline-offset-2 transition-colors hover:underline"
                      >
                        {t("openExplorer")}
                      </a>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center sm:gap-4">
                <Button
                  variant="ghost"
                  fullWidth
                  className="rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[10rem] sm:px-8"
                  onClick={onReset}
                >
                  {t("createAnother")}
                </Button>
                <Link href={`/vs/${createdId}`} className="block sm:inline-block">
                  <Button
                    variant="primary"
                    fullWidth
                    className="rounded-xl py-3.5 font-display text-xs font-bold uppercase tracking-widest sm:w-auto sm:min-w-[10rem] sm:px-8"
                  >
                    {t("viewVS")}
                  </Button>
                </Link>
              </div>
            </div>
          </AnimatedItem>
        </div>
      </PageTransition>
    </>
  );
}
