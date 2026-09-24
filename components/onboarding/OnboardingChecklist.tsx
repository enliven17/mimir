"use client";

/**
 * First-stake checklist: connect, switch to Arc, get USDC, stake once.
 *
 * Every step is read from the wallet rather than ticked by hand (see
 * `lib/onboarding.ts`), so it stays honest if someone funds from another tab or
 * stakes through an agent. It collapses on its own once everything is done and
 * can be dismissed for good.
 */

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { Check, ChevronDown, ExternalLink, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useWallet } from "@/lib/wallet";
import { getChain } from "@/lib/chains";
import { getUserVSFast } from "@/lib/contract";
import { MIN_STAKE } from "@/lib/constants";
import { formatUsdc } from "@/lib/money";
import { DASHBOARD_CARD_SURFACE } from "@/lib/dashboardSurface";
import {
  currentOnboardingStep,
  onboardingSteps,
  readOnboardingDismissed,
  writeOnboardingDismissed,
  type OnboardingStepId,
} from "@/lib/onboarding";

const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
const ARC_CHAIN_ID = getChain("arc").chain.id;

const actionClass =
  "focus-ring inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded border px-3.5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] transition-colors disabled:cursor-wait disabled:opacity-60";
const primaryActionClass = `${actionClass} border-pv-emerald bg-pv-emerald text-white hover:bg-pv-emerald/85`;
const secondaryActionClass = `${actionClass} border-white/[0.18] text-pv-text hover:border-pv-emerald/60 hover:bg-pv-surface2`;

/** Whether this wallet has ever held a claim; null while unknown. */
function useHasStake(address: string | null): boolean | null {
  const [state, setState] = useState<{ address: string; hasStake: boolean } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUserVSFast(address)
      .then((snapshot) => {
        if (!cancelled) setState({ address, hasStake: snapshot.items.length > 0 });
      })
      .catch(() => {
        // Leave it pending: a failed read is not evidence of "no stake".
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return address && state?.address === address ? state.hasStake : null;
}

interface OnboardingChecklistProps {
  className?: string;
}

export default function OnboardingChecklist({ className = "" }: OnboardingChecklistProps) {
  const t = useTranslations("onboarding");
  const headingId = useId();
  const listId = useId();

  const { address, isConnected, isConnecting, connect } = useWallet();
  const { chainId } = useAccount();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const { data: balance } = useBalance({
    address: (address ?? undefined) as `0x${string}` | undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });
  const hasStake = useHasStake(address);

  // null until localStorage has been read, so dismissed users never see a flash
  // and the server render matches the first client render.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);

  useEffect(() => {
    setDismissed(readOnboardingDismissed());
  }, []);

  const arcBalanceUsdc =
    isConnected && balance ? Number(formatUnits(balance.value, balance.decimals)) : null;

  const steps = onboardingSteps({
    isConnected,
    onArc: chainId === ARC_CHAIN_ID,
    arcBalanceUsdc,
    hasStake,
  });
  const doneCount = steps.filter((s) => s.done).length;
  const current = currentOnboardingStep(steps);
  const allDone = current === null;
  const expanded = expandedOverride ?? !allDone;

  if (dismissed !== false) return null;

  const dismiss = () => {
    writeOnboardingDismissed();
    setDismissed(true);
  };

  const renderActions = (id: OnboardingStepId) => {
    switch (id) {
      case "connect":
        return (
          <button
            type="button"
            className={primaryActionClass}
            onClick={() => void connect()}
            disabled={isConnecting}
          >
            {isConnecting ? t("steps.connect.connecting") : t("steps.connect.action")}
          </button>
        );
      case "network":
        if (!isConnected) return null;
        return (
          <button
            type="button"
            className={primaryActionClass}
            onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
            disabled={isSwitching}
          >
            {isSwitching ? t("steps.network.switching") : t("steps.network.action")}
          </button>
        );
      case "fund":
        return (
          <>
            <a
              href={CIRCLE_FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryActionClass}
              aria-label={t("steps.fund.faucetAria")}
            >
              {t("steps.fund.faucet")}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            <Link href="/bridge" className={`${secondaryActionClass} no-underline`}>
              {t("steps.fund.bridge")}
            </Link>
          </>
        );
      case "stake":
        return (
          <>
            <Link href="/explorer" className={`${secondaryActionClass} no-underline`}>
              {t("steps.stake.explore")}
            </Link>
            <Link href="/vs/create" className={`${secondaryActionClass} no-underline`}>
              {t("steps.stake.create")}
            </Link>
          </>
        );
    }
  };

  const renderDetail = (id: OnboardingStepId) => {
    if (id === "network" && switchError && isConnected) {
      return (
        <p role="alert" className="mt-1.5 text-xs text-pv-danger">
          {t("steps.network.failed")}
        </p>
      );
    }
    if (id === "fund" && isConnected) {
      return (
        <p className="mt-1.5 font-mono text-[11px] text-pv-muted">
          {arcBalanceUsdc === null
            ? t("steps.fund.balanceLoading")
            : t("steps.fund.balance", { amount: formatUsdc(arcBalanceUsdc) })}
        </p>
      );
    }
    return null;
  };

  return (
    <section
      aria-labelledby={headingId}
      className={`${DASHBOARD_CARD_SURFACE} overflow-hidden ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
        <h2
          id={headingId}
          className="min-w-0 flex-1 font-display text-xs font-bold uppercase tracking-[0.16em] text-pv-text sm:text-sm"
        >
          {allDone ? t("complete") : t("title")}
        </h2>
        <span
          className="font-mono text-xs tabular-nums text-pv-muted"
          aria-label={t("progressAria", { done: doneCount, total: steps.length })}
        >
          {t("progress", { done: doneCount, total: steps.length })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="focus-ring inline-flex min-h-[44px] items-center gap-1 rounded px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted transition-colors hover:text-pv-text"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpandedOverride(!expanded)}
          >
            {expanded ? t("hide") : t("show")}
            <ChevronDown
              className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="focus-ring inline-flex size-11 items-center justify-center rounded text-pv-muted transition-colors hover:text-pv-text"
            aria-label={t("dismissAria")}
            title={t("dismiss")}
            onClick={dismiss}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div
        className="h-1 w-full bg-white/[0.06]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
        aria-labelledby={headingId}
      >
        <div
          className="h-full bg-pv-emerald transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ol id={listId} hidden={!expanded} className="divide-y divide-white/[0.06]">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex gap-3 px-4 py-4 sm:px-5 ${isCurrent ? "bg-pv-surface2/40" : ""}`}
            >
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${
                  step.done
                    ? "border-pv-emerald bg-pv-emerald text-white"
                    : isCurrent
                      ? "border-pv-text text-pv-text"
                      : "border-white/[0.2] text-pv-muted"
                }`}
                aria-hidden
              >
                {step.done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  className={`text-sm font-semibold ${step.done ? "text-pv-muted line-through decoration-pv-muted/50" : "text-pv-text"}`}
                >
                  {t(`steps.${step.id}.title`)}
                  <span className="sr-only">
                    {" "}
                    ({step.done ? t("stepDone") : t("stepPending")})
                  </span>
                </h3>
                {!step.done ? (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-pv-muted">
                      {step.id === "fund"
                        ? t("steps.fund.desc", { min: MIN_STAKE })
                        : t(`steps.${step.id}.desc`)}
                    </p>
                    {renderDetail(step.id)}
                    <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
                      {renderActions(step.id)}
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
