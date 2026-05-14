"use client";

import { Activity } from "lucide-react";
import { useTranslations } from "next-intl";

function truncate(s: string, max: number) {
  const t = s.trim();
  if (t.length > max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Vista compacta: 0x + 4 hex, "...", últimos 4 caracteres (p. ej. 0x71C7…1a2b). */
function formatWalletForTicket(address: string | null | undefined): string {
  if (!address || typeof address !== "string") {
    return "—";
  }
  const a = address.trim();
  const normalized = a.startsWith("0x") ? a : `0x${a}`;
  if (normalized.length < 12) {
    return normalized;
  }
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export type CreateChallengeTicketProps = {
  draftId: string;
  marketTypeLabel: string;
  oddsModeLabel: string;
  formatLabel: string;
  visibilityLabel: string;
  /** Texto mostrado como vista previa de settlement (regla actual o plantilla guía). */
  settlementPreview: string;
  stakeAmount: number;
  /** Dirección conectada para la línea AUTH_SIG; si no hay, se muestra un marcador. */
  walletAddress?: string | null;
};

/**
 * Ticket lateral en vivo para el flujo de creación de VS (resumen y compromiso).
 */
export default function CreateChallengeTicket({
  draftId,
  marketTypeLabel,
  oddsModeLabel,
  formatLabel,
  visibilityLabel,
  settlementPreview,
  stakeAmount,
  walletAddress,
}: CreateChallengeTicketProps) {
  const t = useTranslations("create");
  const stakeStr = Number.isFinite(stakeAmount) ? stakeAmount.toFixed(2) : "—";
  const body = truncate(settlementPreview.trim(), 240);
  const authDisplay = formatWalletForTicket(walletAddress);
  const showQuoted = body.length > 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-pv-surface/70 shadow-glow-emerald backdrop-blur-[20px] transition-all duration-200">
      {/* Watermark — transitions from UNSIGNED to SIGNED based on wallet */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
        <span className="font-display text-[72px] sm:text-[96px] font-bold uppercase tracking-[0.15em] text-white/[0.02] rotate-[-12deg]">
          {walletAddress ? "SIGNED" : "UNSIGNED"}
        </span>
      </div>
      <div
        className="absolute left-0 top-0 h-1 w-full bg-pv-emerald"
        aria-hidden
      />
      <div className="space-y-8 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold tracking-tighter text-pv-text sm:text-xl">
              {t("challengeTicketTitle")}
            </h2>
            <p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-pv-muted/60">
              <span className="text-pv-muted/40">{t("ticketIdLabel")}</span>{" "}
              <span className="uppercase">{draftId}</span>
            </p>
          </div>
          <Activity
            className="size-6 shrink-0 animate-pulse text-pv-emerald"
            strokeWidth={2}
            aria-hidden
          />
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <div>
              <div className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                {t("marketType")}
              </div>
              <span className="text-sm font-semibold text-pv-text">
                {marketTypeLabel}
              </span>
            </div>
            <div>
              <div className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                {t("oddsMode")}
              </div>
              <span className="text-sm font-semibold text-pv-text">
                {oddsModeLabel}
              </span>
            </div>
            <div>
              <div className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                {t("format")}
              </div>
              <span className="text-sm font-semibold text-pv-text">
                {formatLabel}
              </span>
            </div>
            <div>
              <div className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                {t("visibility")}
              </div>
              <span className="text-sm font-semibold text-pv-emerald">
                {visibilityLabel}
              </span>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/[0.08] pt-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
              {t("settlementRule")}
            </div>
            <p className="text-xs italic leading-relaxed text-pv-text/85">
              {showQuoted ? (
                <>
                  <span className="text-pv-muted/70" aria-hidden>
                    &ldquo;
                  </span>
                  {body}
                  <span className="text-pv-muted/70" aria-hidden>
                    &rdquo;
                  </span>
                </>
              ) : (
                t("ticketSettlementFallback")
              )}
            </p>
          </div>
        </div>

        <div className="space-y-4 border-t border-dashed border-white/[0.08] pt-6">
          <div className="flex items-end justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-pv-muted">
              {t("ticketYourCommitment")}
            </span>
            <span className="font-display text-2xl font-bold tabular-nums text-pv-emerald">
              {stakeStr} GEN
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-black/35 px-4 py-3">
        <div className="flex min-w-0 shrink gap-px" aria-hidden>
          {[1, 2, 2, 3, 2, 1, 2, 1, 2, 1].map((w, i) => (
            <div
              key={i}
              className="h-6 bg-white/[0.14]"
              style={{ width: `${w * 5}px` }}
            />
          ))}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-pv-muted/85">
          {t("ticketAuthSig")}: {authDisplay}
        </span>
      </div>
      <div className="h-1 w-full bg-pv-emerald" aria-hidden />
    </div>
  );
}
