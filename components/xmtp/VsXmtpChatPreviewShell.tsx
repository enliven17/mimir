"use client";

import { useTranslations } from "next-intl";
import { Button, Input } from "@/components/ui";

type VsXmtpChatPreviewShellProps = {
  peerShort: string;
  viewerShort: string;
};

/**
 * Maqueta visual del hilo XMTP para demo 1v1 cuando el rival aún no está en la red.
 * No envía mensajes ni usa el SDK.
 */
export default function VsXmtpChatPreviewShell({
  peerShort,
  viewerShort,
}: VsXmtpChatPreviewShellProps) {
  const t = useTranslations("xmtpVs");

  return (
    <>
      <div
        className="mb-4 max-h-[min(42vh,280px)] min-h-[128px] overflow-y-auto rounded-lg border border-white/[0.08] bg-pv-bg/40 px-3 py-2.5 sm:px-3.5 sm:py-3"
        role="region"
        aria-label={t("chatPreviewAriaLabel")}
      >
        <p className="sr-only">
          {t("chatPreviewSrHint", { peer: peerShort, you: viewerShort })}
        </p>
        <div className="flex flex-col gap-2.5">
          <div className="flex w-full justify-start">
            <div className="max-w-[min(92%,20rem)] rounded-lg border border-white/[0.07] bg-pv-surface2/90 px-3 py-2 text-pv-text/90">
              <p className="mb-1 text-left text-[10px] text-pv-muted/80">
                <span className="font-mono">{peerShort}</span>
              </p>
              <p className="text-[13px] leading-relaxed">{t("chatPreviewBubblePeer")}</p>
            </div>
          </div>
          <div className="flex w-full justify-end">
            <div className="max-w-[min(92%,20rem)] rounded-lg border border-pv-emerald/20 bg-pv-emerald/[0.08] px-3 py-2 text-pv-text">
              <p className="mb-1 text-right text-[10px] text-pv-muted/80">
                <span className="font-mono">{viewerShort}</span>
              </p>
              <p className="text-[13px] leading-relaxed">{t("chatPreviewBubbleYou")}</p>
            </div>
          </div>
          <div className="flex w-full justify-start">
            <div className="max-w-[min(92%,20rem)] rounded-lg border border-white/[0.07] bg-pv-surface2/90 px-3 py-2 text-pv-text/90">
              <p className="mb-1 text-left text-[10px] text-pv-muted/80">
                <span className="font-mono">{peerShort}</span>
              </p>
              <p className="text-[13px] leading-relaxed">{t("chatPreviewBubblePeerShort")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.08] pt-4 opacity-75">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            disabled
            readOnly
            value=""
            placeholder={t("chatPreviewInputPlaceholder")}
            className="min-h-[44px] flex-1 rounded-lg border-white/[0.1] bg-pv-bg/30"
            aria-disabled="true"
          />
          <Button
            type="button"
            variant="primary"
            fullWidth={false}
            className="min-h-[44px] shrink-0 px-6 sm:mb-0"
            disabled
          >
            {t("send")}
          </Button>
        </div>
      </div>

      <p className="text-[10px] text-pv-muted/70 mt-3 leading-relaxed">
        {t("chatPreviewFootnote")}
      </p>
    </>
  );
}
