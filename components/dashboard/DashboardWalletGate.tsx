"use client";

import { Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { GlassCard, Button } from "@/components/ui";

type DashboardWalletGateProps = {
  onConnect: () => void;
  isConnecting: boolean;
};

/** Vista inicial del dashboard cuando no hay wallet (solo card de conexión, sin título de página). */
export default function DashboardWalletGate({
  onConnect,
  isConnecting,
}: DashboardWalletGateProps) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");

  return (
    <PageTransition>
      <AnimatedItem>
        <section
          className="pt-2 sm:pt-4"
          aria-labelledby="dashboard-connect-heading"
        >
          <GlassCard
            glass
            noPad
            glow="none"
            className="relative mx-auto max-w-md overflow-hidden !rounded-2xl !border-white/[0.12] !bg-pv-surface !backdrop-blur-none"
            role="region"
          >
            <div
              className="absolute left-0 top-0 z-[1] h-1 w-full bg-pv-emerald"
              aria-hidden
            />
            <div className="relative px-6 py-8 sm:px-8 sm:py-10">
              <div className="flex justify-center">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <Wallet className="size-6" strokeWidth={2} />
                </span>
              </div>
              <h2
                id="dashboard-connect-heading"
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
                  className="min-w-[12rem] rounded-xl px-8"
                >
                  {isConnecting ? tc("loading") : t("connect")}
                </Button>
              </div>
              <p className="mt-8 text-center text-xs leading-relaxed text-pv-muted/80">
                <Link
                  href="/explorer"
                  className="font-medium text-pv-emerald underline-offset-4 transition-colors hover:text-pv-emerald/85 hover:underline"
                >
                  {t("connectExploreLink")}
                </Link>
              </p>
            </div>
          </GlassCard>
        </section>
      </AnimatedItem>
    </PageTransition>
  );
}
