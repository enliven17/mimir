"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { GlassCard, Button } from "@/components/ui";
import MessagesPageHero from "@/components/xmtp/MessagesPageHero";

type MessagesWalletGateProps = {
  onConnect: () => void;
  isConnecting: boolean;
};

/**
 * Sin wallet: mismo hero que la vista conectada (título + copy), luego card de conexión.
 */
export default function MessagesWalletGate({
  onConnect,
  isConnecting,
}: MessagesWalletGateProps) {
  const t = useTranslations("messagesHub");
  const tc = useTranslations("common");

  return (
    <PageTransition>
      <div className="mx-auto w-full max-w-[720px] px-4 pb-16 sm:px-6">
        <AnimatedItem>
          <MessagesPageHero className="pt-2 sm:pt-4" />
        </AnimatedItem>

        <div className="mt-6 border-t border-white/[0.06] pt-8 sm:mt-8 sm:pt-10">
          <AnimatedItem>
            <section
              aria-labelledby="messages-connect-heading"
              className="mx-auto w-full max-w-md"
            >
              <GlassCard
                glass
                noPad
                glow="none"
                className="relative overflow-hidden !rounded-2xl border border-white/[0.12]"
                role="region"
              >
                <div
                  className="absolute left-0 top-0 z-[1] h-1 w-full bg-pv-emerald"
                  aria-hidden
                />
                <div className="relative px-5 py-8 sm:px-8 sm:py-10">
                  <div className="flex justify-center">
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                      aria-hidden
                    >
                      <Wallet className="size-6" strokeWidth={2} />
                    </span>
                  </div>
                  <h2
                    id="messages-connect-heading"
                    className="mt-6 text-center font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:text-sm sm:tracking-[0.2em]"
                  >
                    {t("connectTitle")}
                  </h2>
                  <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-pv-muted">
                    {t("connectDesc")}
                  </p>
                  <div className="mt-8 flex justify-center">
                    <Button
                      variant="primary"
                      onClick={onConnect}
                      disabled={isConnecting}
                      fullWidth={false}
                      className="min-h-[48px] min-w-[12rem] w-full max-w-xs rounded-xl px-8 sm:w-auto"
                    >
                      {isConnecting ? tc("loading") : t("connect")}
                    </Button>
                  </div>
                  <p className="mt-8 text-center text-xs leading-relaxed text-pv-muted/80">
                    <Link
                      href="/explorer"
                      className="font-medium text-pv-emerald underline-offset-4 transition-colors hover:text-pv-emerald/85 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40"
                    >
                      {t("connectExploreLink")}
                    </Link>
                  </p>
                </div>
              </GlassCard>
            </section>
          </AnimatedItem>
        </div>
      </div>
    </PageTransition>
  );
}
