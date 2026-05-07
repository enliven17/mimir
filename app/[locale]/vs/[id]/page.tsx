"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useWallet } from "@/lib/wallet";
import {
  acceptVS,
  cancelVS,
  didUserChallengeVS,
  getRivalryChain,
  getVS,
  getVSChallengerCount,
  getVSConfiguredMaxChallengers,
  getVSSingleWinnerPayout,
  getVSTotalPot,
  getUserVSDirect,
  hasVSWinner,
  isVSJoinable,
  isVSPrivate,
  requestResolveVS,
  resetVSResolveRequest,
  type ClaimChallenger,
  type VSData,
} from "@/lib/contract";
import { getExplorerTxUrl, createArcPublicClient } from "@/lib/arc";
import { getPendingVS } from "@/lib/pending-vs";
import { acquireTxLock } from "@/lib/tx-lock";
import {
  MIN_STAKE,
  ZERO_ADDRESS,
  getShareUrl,
  shortenAddress,
} from "@/lib/constants";
import {
  MOCK_CREATED_VS_ID,
  mergeMockSnapshotIntoVs,
  readCreateMockSnapshot,
} from "@/lib/mockVsCreate";
import { SAMPLE_VS } from "@/lib/sampleVs";
import { useCountdown } from "@/lib/hooks";
import {
  getStoredPrivateInviteKey,
  rememberPrivateInviteKey,
} from "@/lib/private-links";
import { toast } from "sonner";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import {
  Avatar,
  Badge,
  Button,
  CountdownTimer,
  GlassCard,
  Input,
} from "@/components/ui";
import ProvenStamp from "@/components/ProvenStamp";
import ClaimStrengthCard from "@/components/ClaimStrengthCard";
import SettlementExplanationCard from "@/components/SettlementExplanationCard";
import ResolutionTerminal from "@/components/ResolutionTerminal";
import VsXmtpPanel from "@/components/xmtp/VsXmtpPanel";
import Stage from "@/components/Stage";
import LiveDeadline from "@/components/LiveDeadline";
import { AnimatePresence } from "framer-motion";
import { verdictOverlay, verdictWord, verdictResult } from "@/lib/animations/rituals";
import {
  VS_XMTP_CHAT_ANCHOR_ID,
  shouldMountVsXmtpPanelOnDetailPage,
} from "@/lib/xmtp/vs-chat-eligibility";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Share2,
  SlidersHorizontal,
  Users,
} from "lucide-react";

/** Dirección ficticia para previsualizar fases accepted / verifying / proven en VS de muestra (sin blockchain). */
const DESIGN_PREVIEW_OPPONENT =
  "0x2222222222222222222222222222222222222222";

/** Misma silueta que la píldora «{addr} challenges you» (fucsia, pill redondeada). */
const DUEL_STATUS_FUCHSIA_PILL_CLASS =
  "inline-flex max-w-full min-w-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.08] px-2.5 py-1 text-left text-[11px] font-semibold leading-tight text-pv-fuch shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:px-3 sm:py-1.5 sm:text-xs";

const RIVALRY_ITEM_BASE_CLASS =
  "rounded-xl border p-4 transition-[border-color,background-color] duration-200 bg-pv-bg/30 hover:border-white/[0.22] hover:bg-pv-bg/35";
const RIVALRY_ITEM_ACTIVE_CLASS =
  "border-pv-emerald/[0.35] bg-pv-emerald/[0.08] hover:border-pv-emerald/[0.45] hover:bg-pv-emerald/[0.12]";

/** Demo ticket `-4` (1v1): preview alineado con XMTP y métrica SLOTS 1/1. */
function isDesignPreviewOneVsOneBase(base: VSData): boolean {
  return (
    base.id === MOCK_CREATED_VS_ID && getVSConfiguredMaxChallengers(base) === 1
  );
}

function buildDesignPreviewVs(
  base: VSData,
  step: number,
  resolutionSummary: string,
  resolvedOutcome: "creator" | "challengers" = "creator",
): VSData {
  const oneV1 = isDesignPreviewOneVsOneBase(base);

  if (step <= 0) {
    return {
      ...base,
      state: "open",
      opponent: ZERO_ADDRESS,
      winner: ZERO_ADDRESS,
      resolution_summary: "",
      winner_side: undefined,
      challenger_count: 0,
      challengers: undefined,
      challenger_addresses: undefined,
    };
  }
  if (step <= 2) {
    const pot = getVSTotalPot({
      ...base,
      opponent: DESIGN_PREVIEW_OPPONENT,
      state: "accepted",
    });
    if (oneV1) {
      return {
        ...base,
        state: "accepted",
        opponent: DESIGN_PREVIEW_OPPONENT,
        winner: ZERO_ADDRESS,
        resolution_summary: "",
        winner_side: undefined,
        challenger_count: 1,
        challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
        challengers: [
          {
            address: DESIGN_PREVIEW_OPPONENT,
            stake: base.stake_amount,
            potential_payout: pot,
          },
        ],
      };
    }
    return {
      ...base,
      state: "accepted",
      opponent: DESIGN_PREVIEW_OPPONENT,
      winner: ZERO_ADDRESS,
      resolution_summary: "",
      winner_side: undefined,
      challenger_count: 3,
      challenger_addresses: [DESIGN_PREVIEW_OPPONENT, "0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"],
      challengers: [
        {
          address: DESIGN_PREVIEW_OPPONENT,
          stake: base.stake_amount,
          potential_payout: pot,
        },
        {
          address: "0x3333333333333333333333333333333333333333",
          stake: base.stake_amount,
          potential_payout: pot,
        },
        {
          address: "0x4444444444444444444444444444444444444444",
          stake: base.stake_amount,
          potential_payout: pot,
        },
      ],
    };
  }
  if (step === 3) {
    const resolvedPot = getVSTotalPot({
      ...base,
      opponent: DESIGN_PREVIEW_OPPONENT,
      state: "resolved",
    });

    if (resolvedOutcome === "creator") {
      return {
        ...base,
        state: "resolved",
        opponent: DESIGN_PREVIEW_OPPONENT,
        winner: base.creator,
        winner_side: "creator",
        resolution_summary: resolutionSummary,
        challenger_count: 1,
        challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
        challengers: [
          {
            address: DESIGN_PREVIEW_OPPONENT,
            stake: base.stake_amount,
            potential_payout: resolvedPot,
          },
          {
            address: "0x3333333333333333333333333333333333333333",
            stake: base.stake_amount,
            potential_payout: resolvedPot,
          },
          {
            address: "0x4444444444444444444444444444444444444444",
            stake: base.stake_amount,
            potential_payout: resolvedPot,
          },
        ],
      };
    }

    return {
      ...base,
      state: "resolved",
      opponent: DESIGN_PREVIEW_OPPONENT,
      winner: DESIGN_PREVIEW_OPPONENT,
      winner_side: "challengers",
      resolution_summary: resolutionSummary,
      challenger_count: 1,
      challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
      challengers: [
        {
          address: DESIGN_PREVIEW_OPPONENT,
          stake: base.stake_amount,
          potential_payout: resolvedPot,
        },
      ],
    };
  }

  // step >= 4 => CANCELLED (solo para modo demo/testing)
  const cancelledPot = getVSTotalPot({
    ...base,
    opponent: DESIGN_PREVIEW_OPPONENT,
    state: "cancelled",
  });

  if (oneV1) {
    return {
      ...base,
      state: "cancelled",
      opponent: DESIGN_PREVIEW_OPPONENT,
      winner: ZERO_ADDRESS,
      winner_side: undefined,
      resolution_summary: "",
      challenger_count: 1,
      challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
      challengers: [
        {
          address: DESIGN_PREVIEW_OPPONENT,
          stake: base.stake_amount,
          potential_payout: cancelledPot,
        },
      ],
    };
  }

  if (oneV1) {
    return {
      ...base,
      state: "cancelled",
      opponent: DESIGN_PREVIEW_OPPONENT,
      winner: ZERO_ADDRESS,
      winner_side: undefined,
      resolution_summary: "",
      challenger_count: 1,
      challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
      challengers: [
        {
          address: DESIGN_PREVIEW_OPPONENT,
          stake: base.stake_amount,
          potential_payout: cancelledPot,
        },
      ],
    };
  }

  return {
    ...base,
    state: "cancelled",
    opponent: DESIGN_PREVIEW_OPPONENT,
    winner: ZERO_ADDRESS,
    winner_side: undefined,
    resolution_summary: "",
    challenger_count: 1,
    challenger_addresses: [DESIGN_PREVIEW_OPPONENT],
    challengers: [
      {
        address: DESIGN_PREVIEW_OPPONENT,
        stake: base.stake_amount,
        potential_payout: cancelledPot,
      },
    ],
  };
}

function buildDesignPreviewRematchChain(
  base: VSData,
  firstRoundOutcome: "creator" | "challengers",
  resolutionSummary: string,
): VSData[] {
  // Dos rondas mock para que se vea "Rematch" en el card sin depender de on-chain.
  const isGpt5Vs =
    base.question.startsWith("GPT-5 Announced by OpenAI before ");

  const round1BaseQuestion = isGpt5Vs
    ? base.question.replace(/before\s+[A-Za-z]+\b.*/i, "before February")
    : base.question.includes("March")
      ? base.question.replace("March", "January")
      : base.question;

  const round2BaseQuestion = isGpt5Vs
    ? base.question.replace(/before\s+[A-Za-z]+\b.*/i, "before June")
    : base.question;

  const round1Base: VSData = {
    ...base,
    id: base.id - 100,
    question: round1BaseQuestion,
    creator_position: isGpt5Vs
      ? "OpenAI announces GPT-5 before February"
      : base.creator_position,
    opponent_position: isGpt5Vs
      ? "No official announcement before February"
      : base.opponent_position,
    resolution_summary: resolutionSummary,
  };

  const round2Base: VSData = {
    ...base,
    id: base.id - 101,
    question: round2BaseQuestion,
    creator_position: isGpt5Vs ? "OpenAI announces GPT-5 before June" : base.creator_position,
    opponent_position: isGpt5Vs ? "No official announcement before June" : base.opponent_position,
    resolution_summary: resolutionSummary,
  };

  const round2Outcome: "creator" | "challengers" =
    firstRoundOutcome === "creator" ? "challengers" : "creator";

  // ROUND 3: no llega a PROVEN todavía (se mantiene en "accepted").
  const round3Base: VSData = {
    ...base,
    id: base.id - 102,
    question: "BTC Price will break $100k before August 31",
    resolution_summary: resolutionSummary,
  };

  return [
    buildDesignPreviewVs(round1Base, 3, resolutionSummary, firstRoundOutcome),
    buildDesignPreviewVs(round2Base, 3, resolutionSummary, round2Outcome),
    buildDesignPreviewVs(round3Base, 2, resolutionSummary, "creator"),
  ];
}

type ProgressBarProps = {
  canonicalState: string;
  visualStepIndex?: number | null;
  interactive?: boolean;
  onStepSelect?: (index: number) => void;
};

function ProgressBar({
  canonicalState,
  visualStepIndex = null,
  interactive = false,
  onStepSelect,
}: ProgressBarProps) {
  const t = useTranslations("vsDetail");
  const steps = [
    t("progressCreated"),
    t("progressAccepted"),
    t("progressVerifying"),
    t("progressProven"),
  ];
  const total = steps.length;

  const stepIndexFromState =
    canonicalState === "open"
      ? 0
      : canonicalState === "accepted"
        ? 1
        : canonicalState === "resolved"
          ? 3
          : canonicalState === "cancelled"
            ? -1
            : 0;

  const stepIndex =
    typeof visualStepIndex === "number" && visualStepIndex >= 0 && visualStepIndex <= 3
      ? visualStepIndex
      : stepIndexFromState;

  if (canonicalState === "cancelled" || stepIndexFromState === -1) {
    return null;
  }

  const isResolved = stepIndex >= 3;
  const progressPercent = isResolved ? 100 : ((stepIndex + 1) / total) * 100;
  const phaseCurrent = isResolved ? total : stepIndex + 1;

  const cellClass = (isCurrent: boolean, isDone: boolean) =>
    `flex h-full min-h-[4.5rem] w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-all duration-300 sm:min-h-0 sm:py-3.5 ${
      interactive ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 " : ""
    }${
      isCurrent
        ? "border-pv-emerald/40 bg-pv-emerald/[0.07] shadow-glow-emerald"
        : isDone
          ? "border-pv-emerald/20 bg-pv-emerald/[0.04]"
          : "border-white/[0.06] bg-pv-bg/40"
    } ${interactive && !isCurrent ? "hover:border-white/[0.1]" : ""}`;

  return (
    <nav
      className="mb-8 sm:mb-10"
      aria-label={t("progressAriaLabel")}
    >
      <div className="rounded-2xl border border-white/[0.08] bg-pv-surface/80 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] sm:p-6">
        {/* Expanding phase bar — active phase takes proportional space */}
        <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)} aria-valuetext={t("progressStepFraction", { current: phaseCurrent, total })}>
          {steps.map((_, i) => {
            const isDone = isResolved || i < stepIndex;
            const isCurrent = !isResolved && i === stepIndex;
            const shouldFill = isDone || isCurrent;
            return (
              <motion.div
                key={i}
                className="relative flex-1 h-full overflow-hidden rounded-full bg-white/[0.06]"
                initial={false}
                style={{ transformOrigin: "left center" }}
              >
                <motion.div
                  className={`absolute inset-0 rounded-full ${
                    isDone ? "bg-pv-emerald" : isCurrent ? "bg-pv-emerald animate-phase-glow" : ""
                  }`}
                  initial={false}
                  style={{ transformOrigin: "left center" }}
                  animate={{
                    scaleX: shouldFill ? 1 : 0,
                    opacity: shouldFill ? 1 : 0,
                  }}
                  transition={{
                    duration: 0.5,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                />
              </motion.div>
            );
          })}
        </div>

        <ol className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-4 sm:gap-4">
          {steps.map((step, index) => {
            const isDone = isResolved || index < stepIndex;
            const isCurrent = !isResolved && index === stepIndex;
            const isProvenStep = index === 3;
            const stepNum = String(index + 1).padStart(2, "0");
            const stepCode = `STEP ${stepNum}`;
            const label = `${stepCode}: ${step}`;

            const inner = (
              <>
                <span className="sr-only">{label}</span>
                <span className="font-mono text-[11px] font-medium tabular-nums tracking-[0.12em] text-pv-muted/70 sm:text-[12px]">
                  {stepNum}
                </span>
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-start gap-2 font-display ${
                    isProvenStep
                      ? "text-[9px] sm:text-[10px]"
                      : "text-[10px] sm:text-[11px]"
                  } font-bold uppercase leading-snug tracking-[0.14em] sm:tracking-[0.16em] ${
                    isCurrent
                      ? "text-pv-emerald"
                      : isDone
                        ? "text-pv-text/90"
                        : "text-pv-muted/45"
                  }`}
                >
                  <span>{step}</span>
                  {isDone ? (
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pv-emerald"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : null}
                </span>
              </>
            );

            return (
              <li key={stepCode} className="min-w-0 list-none">
                {interactive && onStepSelect ? (
                  <button
                    type="button"
                    className={cellClass(isCurrent, isDone)}
                    aria-label={label}
                    aria-pressed={isCurrent}
                    onClick={() => onStepSelect(index)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={cellClass(isCurrent, isDone)}>{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

function formatChallengers(vs: VSData): ClaimChallenger[] {
  if (vs.challengers && vs.challengers.length > 0) {
    return vs.challengers;
  }

  return (vs.challenger_addresses ?? []).map((entry) => ({
    address: entry,
    stake: vs.stake_amount,
    potential_payout:
      vs.odds_mode === "fixed" && (vs.challenger_payout_bps ?? 0) > 0
        ? Math.floor((vs.stake_amount * (vs.challenger_payout_bps ?? 0)) / 10000)
        : getVSTotalPot(vs),
  }));
}

function VsChallengersCard({
  challengers,
  counterPosition,
  address,
  challengerCount,
  maxChallengers,
  showLoadMore = false,
  className = "border border-white/[0.12] !rounded-2xl",
}: {
  challengers: ClaimChallenger[];
  counterPosition: string;
  address: string | null | undefined;
  challengerCount: number;
  maxChallengers: number;
  showLoadMore?: boolean;
  className?: string;
}) {
  const t = useTranslations("vsDetail");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Cuando cambiamos de fase del preview o el listado, volvemos al estado colapsado.
    setIsExpanded(false);
  }, [showLoadMore, challengers.length]);

  const visibleChallengers =
    showLoadMore && !isExpanded ? challengers.slice(0, 2) : challengers;
  const canLoadMore = showLoadMore && challengers.length > 2 && !isExpanded;

  return (
    <GlassCard glass glow="none" noPad className={className}>
      <div className="space-y-4 p-5 sm:p-6">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald/85">
              {t("challengers")}
            </div>
            <span
              className="inline-flex shrink-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.12] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch sm:tracking-[0.16em]"
              title={t("slotsFilled", {
                count: challengerCount,
                total: maxChallengers,
              })}
            >
              {t("slotsFilled", {
                count: challengerCount,
                total: maxChallengers,
              })}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-pv-muted">
            {t("challengersHint")}
          </p>
        </div>

        {challengers.length === 0 ? (
          <div
            className="rounded-xl border border-dashed border-white/[0.14] bg-pv-bg/30 px-4 py-9 text-center sm:py-11"
            role="status"
          >
            <Users
              className="mx-auto mb-3 size-10 text-pv-fuch/35 sm:size-11"
              strokeWidth={1.25}
              aria-hidden
            />
            <p className="text-sm leading-relaxed text-pv-muted">
              {t("noChallengersYet")}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.1] bg-pv-bg/25 p-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] sm:p-3.5">
            <ul className="space-y-2 sm:space-y-2.5" role="list">
              {visibleChallengers.map((challenger, index) => (
                <li key={`${challenger.address}-${index}`}>
                  <div className="rounded-lg border border-white/[0.08] bg-gradient-to-br from-pv-fuch/[0.04] via-transparent to-transparent p-2.5 transition-[border-color,background-color] duration-200 hover:border-white/[0.14] sm:p-3">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2.5 md:gap-3">
                      <div
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-pv-fuch/[0.28] bg-pv-fuch/[0.08] font-mono text-[9px] font-bold tabular-nums leading-none text-pv-fuch sm:size-8 sm:text-[10px]"
                        aria-hidden
                      >
                        #{index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                          <span className="break-words font-semibold text-[12px] leading-tight text-pv-text sm:text-[13px]">
                            {shortenAddress(challenger.address)}
                          </span>
                          {address &&
                            challenger.address.toLowerCase() ===
                              address.toLowerCase() && (
                              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-pv-emerald">
                                {t("you")}
                              </span>
                            )}
                        </div>
                        {counterPosition.trim() ? (
                          <p className="mt-1 text-[11px] leading-snug text-pv-muted sm:text-[12px]">
                            {counterPosition}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0 justify-self-end sm:justify-self-start">
                        <div
                          className="flex h-7 min-w-[4rem] items-center justify-center rounded-md border border-white/[0.1] bg-pv-bg/55 px-2 font-mono text-[9px] font-bold tabular-nums leading-none text-pv-fuch sm:h-8 sm:min-w-[4.5rem] sm:text-[10px]"
                          title={t("challengerStake")}
                        >
                          {challenger.stake} GEN
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {canLoadMore ? (
              <div className="pt-3 text-center">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setIsExpanded(true)}
                  className="inline-flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.01] px-3 py-2 text-xs font-semibold text-pv-muted transition-[background-color,border-color] hover:border-white/[0.1] hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/25"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default function VSDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const vsId = Number(params.id);
  const isSampleVS = vsId < 0 && !!SAMPLE_VS[vsId];
  const inviteFromUrl = searchParams.get("invite")?.trim() ?? "";
  const { address, isConnected, connect } = useWallet();
  const t = useTranslations("vsDetail");
  const tc = useTranslations("common");
  const tStamp = useTranslations("stamp");
  const tBadges = useTranslations("badges");

  const [vs, setVS] = useState<VSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchAttempts, setFetchAttempts] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolvePhase, setResolvePhase] = useState(-1);
  const [showVerdict, setShowVerdict] = useState(false);
  const [challengeStake, setChallengeStake] = useState("");
  const [rivalryChain, setRivalryChain] = useState<VSData[]>([]);
  const [rivalryLoading, setRivalryLoading] = useState(false);
  // Evita parpadeos: si cambiamos de `vs.id` o aún no terminó el fetch,
  // mostramos "loading" en vez de "empty" con datos viejos/vacíos.
  const [rivalryLoadedForVsId, setRivalryLoadedForVsId] = useState<number | null>(null);
  const [isRivalryExpanded, setIsRivalryExpanded] = useState(false);
  const [storedInviteKey, setStoredInviteKey] = useState("");
  const [marketTermsOpen, setMarketTermsOpen] = useState(false);
  const marketTermsHeadingId = useId();
  const marketTermsPanelId = useId();
  /** Solo VS de muestra (ids negativos): índice 0–4 para previsualizar diseño sin blockchain. */
  const [designLifecycleStep, setDesignLifecycleStep] = useState<number | null>(null);
  const [designResolvedOutcome, setDesignResolvedOutcome] = useState<"creator" | "challengers">("creator");
  /** Tracks whether a resolve tx was fired so we can reveal the verdict once the state arrives. */
  const pendingResolveRef = useRef(false);
  const attemptedFinalizeResolveTxRef = useRef<string | null>(null);
  const [pendingResolveTxHash, setPendingResolveTxHash] = useState<string | null>(null);
  const [, setHasAttemptedResolve] = useState(false);

  const countdown = useCountdown(vs?.deadline || 0);

  const inviteKey = inviteFromUrl || storedInviteKey;

  useEffect(() => {
    setDesignLifecycleStep(null);
    setDesignResolvedOutcome("creator");
    pendingResolveRef.current = false;
    attemptedFinalizeResolveTxRef.current = null;
    setPendingResolveTxHash(null);
    setHasAttemptedResolve(false);
  }, [vsId]);

  const displayVs = useMemo(() => {
    if (!vs) return null;
    if (!isSampleVS || designLifecycleStep === null) {
      return vs;
    }
    return buildDesignPreviewVs(
      vs,
      designLifecycleStep,
      t("designPreviewResolutionSummary"),
      designResolvedOutcome,
    );
  }, [vs, isSampleVS, designLifecycleStep, t, designResolvedOutcome]);

  useEffect(() => {
    if (isSampleVS) {
      return;
    }

    if (inviteFromUrl) {
      rememberPrivateInviteKey(vsId, inviteFromUrl);
      setStoredInviteKey(inviteFromUrl);
      return;
    }

    setStoredInviteKey(getStoredPrivateInviteKey(vsId));
  }, [inviteFromUrl, isSampleVS, vsId]);

  const fetchVS = useCallback(async () => {
    if (isSampleVS) {
      let data = SAMPLE_VS[vsId];
      if (vsId === MOCK_CREATED_VS_ID) {
        const snap = readCreateMockSnapshot();
        if (snap) {
          data = mergeMockSnapshotIntoVs(data, snap);
        }
      }
      setVS(data);
      setLoading(false);
      return;
    }

    const data = await getVS(vsId, {
      inviteKey,
      viewerAddress: address ?? undefined,
    });
    if (data) {
      setVS(data);
      setLoading(false);
      setFetchAttempts(0);
    } else {
      // Show optimistic data from localStorage while consensus is pending
      const pending = getPendingVS(vsId);
      if (pending) {
        setVS(pending);
        setLoading(false);
      }
      // Keep polling — once on-chain data arrives it replaces the pending item.
      // Give up on the loading spinner after ~2 min.
      setFetchAttempts((prev) => {
        const next = prev + 1;
        if (next >= 12) setLoading(false);
        return next;
      });
    }
  }, [address, inviteKey, isSampleVS, vsId]);

  useEffect(() => {
    fetchVS();
    if (isSampleVS) {
      return;
    }

    const intervalId = setInterval(fetchVS, 10000);
    return () => clearInterval(intervalId);
  }, [fetchVS, isSampleVS]);

  useEffect(() => {
    if (!vs || vs.state !== "resolved" || !pendingResolveRef.current) {
      return;
    }

    pendingResolveRef.current = false;
    attemptedFinalizeResolveTxRef.current = null;
    setPendingResolveTxHash(null);
    setHasAttemptedResolve(false);
    setShowVerdict(true);

    const timer = setTimeout(() => setShowVerdict(false), 4000);
    return () => clearTimeout(timer);
  }, [vs]);

  useEffect(() => {
    if (!pendingResolveTxHash || isSampleVS) {
      return;
    }

    let cancelled = false;
    const resolveTxHash = pendingResolveTxHash as `0x${string}`;

    async function watchResolveTransaction() {
      // On Arc, transactions have sub-second finality — just wait for the EVM receipt.
      const client = createArcPublicClient();
      try {
        const receipt = await client.waitForTransactionReceipt({ hash: resolveTxHash });
        if (cancelled) return;

        if (receipt.status === "reverted") {
          pendingResolveRef.current = false;
          attemptedFinalizeResolveTxRef.current = null;
          setPendingResolveTxHash(null);
          toast.error(t("resolveExecutionFailed"));
        } else {
          attemptedFinalizeResolveTxRef.current = null;
          setPendingResolveTxHash(null);
        }
        void fetchVS();
      } catch {
        if (!cancelled) {
          toast(t("resolveStillPending"));
        }
      }
    }

    void watchResolveTransaction();

    return () => {
      cancelled = true;
    };
  }, [address, fetchVS, isSampleVS, pendingResolveTxHash, t]);

  useEffect(() => {
    setChallengeStake("");
  }, [vsId]);

  useEffect(() => {
    if (vs && challengeStake === "") {
      setChallengeStake(String(vs.stake_amount));
    }
  }, [challengeStake, vs]);

  useEffect(() => {
    // La rivalry chain puede ser costosa y además se recalcula en cada refresh del VS.
    // Para evitar parpadeos en despliegues (polling), solo la cargamos cuando el duelo
    // entra a fase PROVEN/resolved.
    if (isSampleVS || !vs) return;

    if (vs.state !== "resolved") {
      setRivalryChain([]);
      setRivalryLoading(false);
      setRivalryLoadedForVsId(null);
      return;
    }

    let cancelled = false;
    const currentVsId = vs.id;

    async function loadRivalry() {
      setRivalryLoadedForVsId(null);
      setRivalryLoading(true);

      try {
        const ids = await getRivalryChain(currentVsId);
        if (cancelled) return;

        if (ids.length === 0) {
          setRivalryChain([]);
          return;
        }

        const items = await Promise.all(ids.map((id) => getVS(id)));
        if (cancelled) return;

        setRivalryChain(items.filter((item): item is VSData => item !== null));
      } catch {
        if (!cancelled) {
          setRivalryChain([]);
        }
      } finally {
        if (!cancelled) {
          setRivalryLoading(false);
          setRivalryLoadedForVsId(currentVsId);
        }
      }
    }

    loadRivalry();

    return () => {
      cancelled = true;
    };
  }, [isSampleVS, vs?.id, vs?.state]);

  useEffect(() => {
    // Para mantener coherencia visual, colapsamos el rematch list cuando cambia la data.
    setIsRivalryExpanded(false);
  }, [vs?.id, rivalryChain.length, designLifecycleStep, designResolvedOutcome]);

  const visibleRivalryChain =
    rivalryChain.length > 2 && !isRivalryExpanded
      ? rivalryChain.slice(0, 2)
      : rivalryChain;
  const canLoadMoreRivalry = rivalryChain.length > 2 && !isRivalryExpanded;
  const isRivalryDataReady =
    isSampleVS || (rivalryLoadedForVsId !== null && rivalryLoadedForVsId === vs?.id);

  useEffect(() => {
    // En demo/testing (VS de muestra) simulamos el rematch para que la card
    // `RIVALRY CHAIN` muestre rondas adicionales en el preview.
    if (!isSampleVS || !vs) return;

    if (designLifecycleStep !== 3) {
      setRivalryChain([]);
      setRivalryLoading(false);
      setRivalryLoadedForVsId(null);
      return;
    }

    setRivalryLoading(false);
    setRivalryChain(
      buildDesignPreviewRematchChain(
        vs,
        designResolvedOutcome,
        t("designPreviewResolutionSummary"),
      )
    );
    setRivalryLoadedForVsId(vs.id);
  }, [
    isSampleVS,
    vs,
    designLifecycleStep,
    designResolvedOutcome,
    t,
  ]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-2 border-transparent border-t-pv-emerald rounded-full animate-spin mx-auto mb-4" />
        <p className="text-pv-muted text-sm">
          {fetchAttempts > 1 ? t("submittedPending") : tc("loading")}
        </p>
      </div>
    );
  }

  if (!vs) {
    return (
      <div className="text-center py-20">
        <p className="font-display font-bold text-lg mb-4">{t("notFound")}</p>
        <Link href="/">
          <Button variant="primary" fullWidth={false} className="px-8">
            {tc("back")}
          </Button>
        </Link>
      </div>
    );
  }

  const display = displayVs!;

  const isCreator = address?.toLowerCase() === vs.creator.toLowerCase();
  const isOpponent = didUserChallengeVS(display, address);
  const isPrivateVS = isVSPrivate(vs);
  const missingPrivateInvite = isPrivateVS && !inviteKey && !isCreator && !isOpponent;
  const canAccept =
    !isSampleVS &&
    !missingPrivateInvite &&
    isVSJoinable(vs, address) &&
    isConnected;
  const canCancel = !isSampleVS && vs.state === "open" && isCreator;
  const hasWinner = hasVSWinner(display);
  const creatorRequestedResolve = Boolean(display.creator_requested_resolve);
  const challengerRequestedResolve = Boolean(display.challenger_requested_resolve);
  const isParticipant = isCreator || isOpponent;
  const userRequestedResolve = isCreator
    ? creatorRequestedResolve
    : isOpponent
      ? challengerRequestedResolve
      : false;
  const counterpartyRequestedResolve = isCreator
    ? challengerRequestedResolve
    : isOpponent
      ? creatorRequestedResolve
      : false;
  const canRequestResolve =
    !isSampleVS &&
    display.state === "accepted" &&
    countdown.expired &&
    isConnected &&
    isParticipant &&
    !userRequestedResolve;
  const canResetResolveRequest =
    !isSampleVS &&
    display.state === "accepted" &&
    countdown.expired &&
    isConnected &&
    isParticipant &&
    (creatorRequestedResolve || challengerRequestedResolve);
  const willTriggerResolution = canRequestResolve && counterpartyRequestedResolve;
  const showRetryResolve = canRequestResolve && (display.resolve_attempts ?? 0) > 0;
  const challengerCount = getVSChallengerCount(display);
  const maxChallengers =
    typeof display.max_challengers === "number" && display.max_challengers > 0
      ? display.max_challengers
      : 1;
  const hasAnyChallenger = challengerCount > 0;
  const isOpen = !hasAnyChallenger;
  const pool = getVSTotalPot(display);
  const challengers = formatChallengers(display);
  const resolvedPayout = getVSSingleWinnerPayout(display);
  const isDesignSampleLost =
    isSampleVS && designLifecycleStep === 3 && designResolvedOutcome === "challengers";
  const isDesignSampleWin =
    isSampleVS && designLifecycleStep === 3 && designResolvedOutcome === "creator";

  const winnerTitle = !hasWinner
    ? tStamp("draw")
    : isDesignSampleLost
      ? tStamp("lost")
      : isDesignSampleWin
        ? tStamp("youWon")
        : tStamp("won", { address: shortenAddress(display.winner) });
  const provenResultTone = isDesignSampleLost ? "lost" : isDesignSampleWin ? "win" : undefined;
  const winnerAmountLabel =
    !hasWinner
      ? null
      : resolvedPayout === null
        ? `${pool} GEN`
        : `${provenResultTone === "lost" ? "-" : "+"}${resolvedPayout} GEN`;
  const marketType = display.market_type ?? "binary";
  const oddsMode = display.odds_mode ?? "pool";
  const challengeStakeValue = Number(challengeStake);
  const hasValidChallengeStake =
    Number.isFinite(challengeStakeValue) && challengeStakeValue >= MIN_STAKE;
  const fixedPayoutPreview =
    oddsMode === "fixed" &&
    hasValidChallengeStake &&
    typeof vs.challenger_payout_bps === "number" &&
    vs.challenger_payout_bps > 0
      ? Math.floor((challengeStakeValue * vs.challenger_payout_bps) / 10000)
      : null;
  const showRivalrySection =
    rivalryChain.length > 1 || display.state === "resolved";
  const shareUrl = getShareUrl(vsId, inviteKey);

  async function handleAccept() {
    const walletReady = isConnected && !!address;
    if (!walletReady) {
      return;
    }
    if (!hasValidChallengeStake) {
      toast.error(t("invalidChallengeStakeMin", { amount: MIN_STAKE }));
      return;
    }

    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }

    flushSync(() => {
      setActionLoading("accept");
    });
    try {
      const liveVS = await getVS(vsId, {
        inviteKey,
        viewerAddress: address,
      });

      if (!liveVS) {
        setVS(null);
        toast.error(t("notFound"));
        return;
      }

      setVS(liveVS);

      if (!isVSJoinable(liveVS, address)) {
        toast.error(t("challengeUnavailable"));
        return;
      }

      const result = await acceptVS(address!, vsId, challengeStakeValue, inviteKey);
      const isPending = "pending" in result && Boolean(result.pending);

      toast.success(
        isPending
          ? t("submittedPending")
          : t("joinedToast", {
              amount: challengeStakeValue,
              total: getVSTotalPot(liveVS) + challengeStakeValue,
            }),
        (result.explorerTxHash || result.txHash) ? { description: `Tx: ${(result.explorerTxHash || result.txHash).slice(0, 10)}...${(result.explorerTxHash || result.txHash).slice(-8)}` } : undefined
      );
      fetchVS();
    } catch (err: any) {
      toast.error(err.message || t("errorAccepting"));
    } finally {
      releaseLock?.();
      setActionLoading(null);
    }
  }

  async function handleResolve() {
    const walletReady = isConnected && !!address;
    if (!walletReady) {
      return;
    }

    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }

    setActionLoading("resolve");
    if (willTriggerResolution) {
      setResolvePhase(0);
    }

    // La terminal escribe letra por letra (muy lento). Sincronizamos el avance de fase
    // para que se puedan ver TODAS las líneas (incl. "Fetching results..." y "Issuing verdict").
    // Si el tx on-chain tarda menos, mantenemos la terminal visible hasta terminar la animación.
    const t1 = willTriggerResolution ? setTimeout(() => setResolvePhase(1), 2600) : null;
    const t2 = willTriggerResolution ? setTimeout(() => setResolvePhase(2), 4600) : null;
    const t3 = willTriggerResolution ? setTimeout(() => setResolvePhase(3), 6500) : null;
    const t4 = willTriggerResolution ? setTimeout(() => setResolvePhase(4), 8400) : null;
    const ANIM_TOTAL_MS = 9600;
    const startedAt = Date.now();

    try {
      const result = await requestResolveVS(address!, vsId, inviteKey);
      const isPending = "pending" in result && Boolean(result.pending);
      setHasAttemptedResolve(willTriggerResolution);
      toast.success(
        willTriggerResolution
          ? isPending
            ? t("submittedPending")
            : t("requestResolveTriggered")
          : t("requestResolveStored"),
        (result.explorerTxHash || result.txHash) ? { description: `Tx: ${(result.explorerTxHash || result.txHash).slice(0, 10)}...${(result.explorerTxHash || result.txHash).slice(-8)}` } : undefined
      );

      if (willTriggerResolution && isPending) {
        // Consensus hasn't finished — don't reveal the verdict yet.
        // A useEffect watches vs.state and will auto-reveal once the
        // data transitions to "resolved" (with a winner).
        pendingResolveRef.current = true;
        setPendingResolveTxHash(result.explorerTxHash || result.txHash || null);
      } else if (willTriggerResolution) {
        setPendingResolveTxHash(null);
        setShowVerdict(true);
        setTimeout(() => setShowVerdict(false), 4000);
      } else {
        setPendingResolveTxHash(null);
      }
      void fetchVS();

      // Asegura que la terminal tenga tiempo de mostrar la última línea aunque la tx
      // se confirme rápido.
      const elapsed = Date.now() - startedAt;
      if (willTriggerResolution && elapsed < ANIM_TOTAL_MS) {
        await new Promise((r) => setTimeout(r, ANIM_TOTAL_MS - elapsed));
      }
    } catch (err: any) {
      toast.error(err.message || t("errorResolving"));
    } finally {
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
      if (t3) clearTimeout(t3);
      if (t4) clearTimeout(t4);
      if (willTriggerResolution) {
        setResolvePhase(-1);
      }
      releaseLock?.();
      setActionLoading(null);
    }
  }

  async function handleResetResolveRequest() {
    const walletReady = isConnected && !!address;
    if (!walletReady) {
      return;
    }

    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }

    setActionLoading("resetResolve");
    try {
      const result = await resetVSResolveRequest(address!, vsId, inviteKey);
      toast.success(
        t("resetResolveRequestSuccess"),
        (result.explorerTxHash || result.txHash)
          ? {
              description: `Tx: ${(result.explorerTxHash || result.txHash).slice(0, 10)}...${(result.explorerTxHash || result.txHash).slice(-8)}`,
            }
          : undefined
      );
      void fetchVS();
    } catch (err: any) {
      toast.error(err.message || t("resetResolveRequestError"));
    } finally {
      releaseLock?.();
      setActionLoading(null);
    }
  }

  async function handleCancel() {
    const walletReady = isConnected && !!address;
    if (!walletReady) {
      return;
    }

    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }

    setActionLoading("cancel");
    try {
      const result = await cancelVS(address!, vsId, inviteKey);
      const isPending = "pending" in result && Boolean(result.pending);
      toast.success(
        isPending ? t("submittedPending") : t("cancelledToast"),
        (result.explorerTxHash || result.txHash) ? { description: `Tx: ${(result.explorerTxHash || result.txHash).slice(0, 10)}...${(result.explorerTxHash || result.txHash).slice(-8)}` } : undefined
      );
      fetchVS();
    } catch (err: any) {
      toast.error(err.message || t("errorCancelling"));
    } finally {
      releaseLock?.();
      setActionLoading(null);
    }
  }

  return (
    <>
      {/* Verdict Reveal Overlay — finality moment */}
      <AnimatePresence>
        {showVerdict && (
          <motion.div
            variants={verdictOverlay}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-pv-bg/90 backdrop-blur-sm"
          >
            <motion.div
              variants={verdictWord}
              className="font-display text-[clamp(3rem,15vw,8rem)] font-bold uppercase text-pv-emerald drop-shadow-[0_0_40px_rgba(78,222,163,0.4)]"
            >
              PROVEN.
            </motion.div>
            <motion.div
              variants={verdictResult}
              className="mt-4 font-mono text-sm text-pv-muted"
            >
              {winnerTitle}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <PageTransition>
        <div className="relative z-[1] mx-auto w-full max-w-[1280px] px-4 pb-16 pt-2 sm:px-6 sm:pb-20 sm:pt-4">
          <div className="mx-auto w-full min-w-0">
        <AnimatedItem>
          <Link
            href={isConnected ? "/dashboard" : "/"}
            className="mb-6 inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[color,border-color,background-color] hover:border-white/[0.1] hover:bg-white/[0.04] hover:text-pv-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/30 sm:mb-8 sm:px-3 sm:text-[11px]"
          >
            <ArrowLeft size={14} className="shrink-0 opacity-80" aria-hidden />
            {tc("back")}
          </Link>
        </AnimatedItem>

        <AnimatedItem>
          <div className="mb-6 sm:mb-8">
            <div className="mb-4 flex flex-wrap items-center gap-4 sm:gap-6">
              <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
                <h1 className="min-w-0 max-w-4xl font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
                  {t("heroLead")}
                </h1>
                <div
                  className="h-px min-w-[2rem] flex-1 bg-white/[0.12]"
                  aria-hidden
                />
              </div>
            </div>
            <span className="block max-w-2xl font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
              {t("subtitle")}
            </span>
          </div>
        </AnimatedItem>

        {(isSampleVS ? display.state : vs.state) !== "cancelled" && (
          <AnimatedItem>
            <ProgressBar
              canonicalState={isSampleVS ? display.state : vs.state}
              visualStepIndex={isSampleVS ? designLifecycleStep : null}
              interactive={isSampleVS}
              onStepSelect={
                isSampleVS
                  ? (index) => {
                      setDesignLifecycleStep(index);
                      if (index !== 3) setDesignResolvedOutcome("creator");
                    }
                  : undefined
              }
            />
            {isSampleVS && (
              <div className="mb-8 flex flex-col gap-2 border-b border-white/[0.06] pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <p className="max-w-3xl text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                  {t("designPreviewLifecycleHint")}
                </p>
                {designLifecycleStep !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDesignLifecycleStep(null);
                      setDesignResolvedOutcome("creator");
                    }}
                    className="shrink-0 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-pv-emerald/90 underline-offset-2 hover:underline sm:text-right sm:text-[11px]"
                  >
                    {t("designPreviewReset")}
                  </button>
                ) : null}
              </div>
            )}
          </AnimatedItem>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-10">
          <div className="min-w-0 lg:col-span-8">
        {display.state === "resolved" && resolvePhase === -1 && (
          <>
            <AnimatedItem>
              <ProvenStamp
                title={winnerTitle}
                amountLabel={winnerAmountLabel}
                resolutionSummary={display.resolution_summary}
                resultTone={provenResultTone}
              />
            </AnimatedItem>
            <AnimatedItem>
              <div className="mb-6 sm:mb-8">
                <SettlementExplanationCard vs={display} />
              </div>
            </AnimatedItem>
          </>
        )}

        {((actionLoading === "resolve" && willTriggerResolution) ||
          (isSampleVS && designLifecycleStep === 2)) && (
          <AnimatedItem>
            <ResolutionTerminal
              phase={actionLoading === "resolve" ? resolvePhase : 4}
              url={display.resolution_url}
            />
          </AnimatedItem>
        )}

        {(display.state !== "resolved" || resolvePhase !== -1) &&
          actionLoading !== "resolve" && (
          <AnimatedItem>
            <Stage glow="both" className="mb-6 border border-white/[0.10] sm:mb-8">
              <div className="relative">
                <div className="relative z-[1]">
              <div className="p-5 sm:p-8">
                <div className="mb-5 flex items-center justify-between sm:mb-6">
                  {display.state === "open" && !isCreator ? (
                    <div className={DUEL_STATUS_FUCHSIA_PILL_CLASS}>
                      {t("challengesYou", { address: shortenAddress(display.creator) })}
                    </div>
                  ) : display.state === "accepted" ? (
                    <div className={DUEL_STATUS_FUCHSIA_PILL_CLASS}>
                      {tBadges("accepted")}
                    </div>
                  ) : (
                    <Badge status={display.state} large />
                  )}
                  <span className="font-mono text-[11px] text-pv-muted">#{vs.id}</span>
                </div>

                <h2 className="mb-6 font-display text-[clamp(28px,8.5vw,46px)] font-bold leading-[0.92] tracking-tight sm:mb-7">
                  {display.question}
                </h2>

                <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-white/[0.12] sm:flex-row">
                  <div className="flex-1 p-4 bg-pv-cyan/[0.04]">
                    <div className="flex items-center gap-2 mb-2">
                      <Avatar side="creator" size={28} />
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-cyan/60 sm:text-[11px]">
                        {t("creator")}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">
                      {shortenAddress(display.creator)}
                      {isCreator && (
                        <span className="text-pv-emerald text-[10px] ml-1">{t("you")}</span>
                      )}
                    </div>
                    <div className="text-xs text-pv-cyan mt-1">{display.creator_position}</div>
                  </div>

                  <div
                    className="h-px w-full shrink-0 bg-white/[0.06] sm:h-auto sm:w-px sm:self-stretch"
                    aria-hidden
                  />

                  <div className="flex-1 p-4 bg-pv-fuch/[0.04]">
                    {isOpen ? (
                      <div className="text-center py-2">
                        <div className="w-7 h-7 border-2 border-dashed border-white/[0.2] flex items-center justify-center mx-auto mb-2 text-pv-muted font-bold text-xs">
                          ?
                        </div>
                        <div className="text-xs text-pv-muted italic">{t("waitingRival")}</div>
                      </div>
                    ) : challengerCount === 1 ? (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Avatar side="opponent" size={28} />
                          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch/60 sm:text-[11px]">
                            {t("rival")}
                          </div>
                        </div>
                        <div className="text-sm font-semibold">
                          {shortenAddress(display.opponent)}
                          {isOpponent && (
                            <span className="text-pv-emerald text-[10px] ml-1">{t("you")}</span>
                          )}
                        </div>
                        <div className="text-xs text-pv-fuch mt-1">{display.opponent_position}</div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Users size={15} className="text-pv-fuch" />
                          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch/60 sm:text-[11px]">
                            {t("challengerSide")}
                          </div>
                        </div>
                        <div className="text-sm font-semibold">
                          {t("challengersJoined", { count: challengerCount })}
                        </div>
                        <div className="text-xs text-pv-fuch mt-1">{display.counter_position}</div>
                        <div className="text-xs text-pv-muted mt-2">
                          {t("slotsFilled", { count: challengerCount, total: maxChallengers })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Métricas: mobile-first — 1 col → 2 (sm) → 4 (lg); panel unificado + celdas con min-h táctil */}
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.07] p-px shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:grid-cols-2 lg:grid-cols-4">
                  {/* Misma estructura en las 4: título arriba (shrink-0) + valor abajo (mt-auto) para alinear filas */}
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("pool")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-gold sm:text-lg lg:text-xl">
                      {pool} GEN
                    </div>
                  </div>
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("creatorStake")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-cyan sm:text-lg lg:text-xl">
                      {display.creator_stake ?? display.stake_amount} GEN
                    </div>
                  </div>
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("deadline")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2">
                      <LiveDeadline
                        deadline={display.deadline}
                        phase={
                          display.state === "open" ? "open"
                            : display.state === "accepted" ? "locked"
                            : display.state === "resolved" ? "proven"
                            : undefined
                        }
                        compact
                        showPhaseBadge={false}
                        timeClassName="text-base sm:text-lg lg:text-xl"
                      />
                    </div>
                  </div>
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("slots")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-fuch sm:text-lg lg:text-xl">
                      {challengerCount}/{maxChallengers}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-3 sm:px-8">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(78,222,163,0.6)]" />
                  <span className="text-xs text-pv-muted">{t("provenVerifies")}</span>
                </div>
                {display.resolution_url && (
                  <a
                    href={
                      display.resolution_url.startsWith("http")
                        ? display.resolution_url
                        : `https://${display.resolution_url}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-pv-muted hover:text-pv-cyan transition-colors flex items-center gap-1"
                  >
                    <ExternalLink size={10} />
                    {t("source")}
                  </a>
                )}
              </div>
                </div>
              </div>
            </Stage>
          </AnimatedItem>
        )}

        {shouldMountVsXmtpPanelOnDetailPage(vs) && (
          <AnimatedItem>
            <div
              id={VS_XMTP_CHAT_ANCHOR_ID}
              className="scroll-mt-[calc(3.5rem+12px)]"
            >
              <VsXmtpPanel vs={display} />
            </div>
          </AnimatedItem>
        )}

        <AnimatedItem>
          <GlassCard
            glass
            glow="none"
            noPad
            className="mb-6 w-full overflow-hidden !rounded-2xl border border-white/[0.12] sm:mb-8"
          >
            <button
              type="button"
              onClick={() => setMarketTermsOpen((open) => !open)}
              aria-expanded={marketTermsOpen}
              aria-controls={marketTermsPanelId}
              className="flex w-full min-h-[3.25rem] items-start justify-between gap-3 px-5 py-5 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-emerald/35 sm:min-h-0 sm:gap-4 sm:px-8 sm:py-6"
            >
              <div className="flex min-w-0 gap-3 sm:gap-3.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                  aria-hidden
                >
                  <SlidersHorizontal size={16} strokeWidth={2} />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3
                    id={marketTermsHeadingId}
                    className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]"
                  >
                    {t("marketTerms")}
                  </h3>
                  <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                    {t("marketTermsHint")}
                  </p>
                </div>
              </div>
              <ChevronDown
                size={20}
                className={`shrink-0 text-pv-muted transition-transform duration-200 ease-out ${
                  marketTermsOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            <motion.div
              initial={false}
              animate={{
                height: marketTermsOpen ? "auto" : 0,
                opacity: marketTermsOpen ? 1 : 0,
              }}
              transition={{
                height: {
                  duration: 0.34,
                  ease: [0.25, 0.46, 0.45, 0.94],
                },
                opacity: {
                  duration: 0.22,
                  ease: [0.25, 0.1, 0.25, 1],
                },
              }}
              className={`overflow-hidden ${!marketTermsOpen ? "pointer-events-none" : ""}`}
              aria-hidden={!marketTermsOpen}
            >
              <div
                id={marketTermsPanelId}
                role="region"
                aria-labelledby={marketTermsHeadingId}
                className="border-t border-white/[0.08] px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6"
              >
                <div className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2 sm:gap-3">
                  <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                      {t("marketType")}
                    </div>
                    <div className="font-semibold">{t(`marketTypes.${marketType}`)}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                      {t("oddsMode")}
                    </div>
                    <div className="font-semibold">{t(`oddsModes.${oddsMode}`)}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                      {t("format")}
                    </div>
                    <div className="font-semibold">{t("headToHeadSummary")}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                      {t("challengerCapacity")}
                    </div>
                    <div className="font-semibold">
                      {t("slotsFilled", { count: challengerCount, total: maxChallengers })}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                      {t("visibility")}
                    </div>
                    <div className="font-semibold">
                      {isPrivateVS ? t("visibilityPrivate") : t("visibilityPublic")}
                    </div>
                  </div>
                  {oddsMode === "fixed" && typeof display.challenger_payout_bps === "number" && (
                    <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4 sm:col-span-2">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {t("fixedPayout")}
                      </div>
                      <div className="font-semibold">
                        {(display.challenger_payout_bps / 10000).toFixed(2)}x
                      </div>
                    </div>
                  )}
                  {display.handicap_line && (
                    <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4 sm:col-span-2">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {t("handicapLine")}
                      </div>
                      <div className="font-semibold">{display.handicap_line}</div>
                    </div>
                  )}
                  {display.settlement_rule && (
                    <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4 sm:col-span-2">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {t("settlementRule")}
                      </div>
                      <div className="font-semibold leading-relaxed">{display.settlement_rule}</div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </GlassCard>
        </AnimatedItem>

        {null}

        {!isSampleVS ? (
          <AnimatedItem>
            <div className="flex flex-col gap-3 sm:gap-4">
              {missingPrivateInvite && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12]">
                  <div className="mb-2 text-sm font-semibold text-pv-emerald">
                    {t("privateInviteRequired")}
                  </div>
                  <p className="text-sm text-pv-muted">{t("privateInviteHint")}</p>
                </GlassCard>
              )}

              {canAccept && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12]">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                      <Input
                        label={t("challengeStake")}
                        type="number"
                        min={MIN_STAKE}
                        step="1"
                        value={challengeStake}
                        onChange={(event) => setChallengeStake(event.target.value)}
                      />
                      <Button
                        variant="fuch"
                        fullWidth={false}
                        onClick={handleAccept}
                        loading={actionLoading === "accept"}
                        disabled={!hasValidChallengeStake}
                        className="sm:min-w-[12rem]"
                      >
                        {actionLoading === "accept"
                          ? t("accepting")
                          : t("acceptAndStake", {
                              amount: hasValidChallengeStake ? challengeStakeValue : vs.stake_amount,
                            })}
                      </Button>
                    </div>
                    <p className="text-xs text-pv-muted mt-3">
                      {fixedPayoutPreview !== null
                        ? t("challengeStakeHintFixed", { payout: fixedPayoutPreview })
                        : t("challengeStakeHintHeadToHead")}
                    </p>
                    <p className="text-xs text-pv-muted mt-2">
                      {t("minimumStakeHint", { amount: MIN_STAKE })}
                    </p>
                </GlassCard>
              )}

              {vs.state === "open" && !isConnected && (
                <Button onClick={connect}>{t("connectToAccept")}</Button>
              )}

              {display.state === "accepted" && countdown.expired && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12]">
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm font-semibold text-pv-text">
                        {t("resolutionStatusTitle")}
                      </div>
                      <p className="mt-1 text-sm text-pv-muted">
                        {t("resolutionStatusHint")}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                          {t("creatorRequestedLabel")}
                        </div>
                        <div className="mt-1 font-semibold">
                          {creatorRequestedResolve ? t("requestedStatus") : t("pendingStatus")}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                          {t("challengerRequestedLabel")}
                        </div>
                        <div className="mt-1 font-semibold">
                          {challengerRequestedResolve ? t("requestedStatus") : t("pendingStatus")}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {t("resolveAttemptsLabel")}
                      </div>
                      <div className="mt-1 font-semibold">{display.resolve_attempts ?? 0}</div>
                    </div>
                    {display.resolution_summary ? (
                      <div className="rounded-xl border border-white/[0.08] bg-pv-bg/40 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                          {t("latestResolutionNote")}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-pv-text/90">
                          {display.resolution_summary}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </GlassCard>
              )}

              {canRequestResolve && actionLoading !== "resolve" && (
                <GlassCard glass className="!rounded-2xl border border-pv-emerald/20">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-pv-text">
                        {showRetryResolve ? t("retryResolveVS") : t("requestResolveVS")}
                      </div>
                      <p className="mt-1 text-sm text-pv-muted">
                        {willTriggerResolution
                          ? t("requestResolveReadyHint")
                          : showRetryResolve
                            ? t("retryResolveHint")
                            : t("requestResolveHint")}
                      </p>
                    </div>
                    <Button variant="emerald" onClick={handleResolve}>
                      {showRetryResolve ? t("retryResolveVS") : t("requestResolveVS")}
                    </Button>
                  </div>
                </GlassCard>
              )}

              {canResetResolveRequest && actionLoading !== "resetResolve" && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-pv-text">
                        {t("resetResolveRequest")}
                      </div>
                      <p className="mt-1 text-sm text-pv-muted">
                        {t("resetResolveRequestHint")}
                      </p>
                    </div>
                    <Button variant="ghost" onClick={handleResetResolveRequest}>
                      {t("resetResolveRequest")}
                    </Button>
                  </div>
                </GlassCard>
              )}

              {display.state === "accepted" &&
                countdown.expired &&
                isParticipant &&
                userRequestedResolve &&
                !counterpartyRequestedResolve &&
                actionLoading !== "resolve" && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12] text-center">
                  <p className="text-sm text-pv-muted">{t("waitingOtherResolveRequest")}</p>
                </GlassCard>
              )}

              {display.state === "accepted" &&
                countdown.expired &&
                !isParticipant && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12] text-center">
                  <p className="text-sm text-pv-muted">{t("participantsMustRequestResolve")}</p>
                </GlassCard>
              )}

              {vs.state === "accepted" && !countdown.expired && actionLoading !== "resolve" && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12] text-center">
                  <p className="text-sm text-pv-muted">{t("waitingDeadline")}</p>
                </GlassCard>
              )}

              {vs.state === "open" &&
                isCreator && (
                <GlassCard
                  glass
                  noPad
                  glow="none"
                  className="!rounded-2xl border border-white/[0.12]"
                >
                  <div className="space-y-3 p-5 sm:p-6">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-pv-text">
                      <Share2 size={14} className="shrink-0 text-pv-cyan" aria-hidden />
                      {isPrivateVS
                        ? t("sendPrivateLink")
                        : t("sendLink")}
                    </div>
                    {isPrivateVS && !inviteKey ? (
                      <p className="text-sm text-pv-muted">{t("privateLinkUnavailable")}</p>
                    ) : (
                      <>
                        <label
                          className="block text-left text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted"
                          htmlFor="vs-detail-share-url"
                        >
                          {t("shareLinkLabel")}
                        </label>
                        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch sm:gap-3">
                          <input
                            id="vs-detail-share-url"
                            readOnly
                            value={shareUrl}
                            className="form-field-pv min-h-[3rem] flex-1 break-all font-mono text-[11px] leading-snug sm:min-h-0 sm:text-xs"
                          />
                          <Button
                            type="button"
                            variant="primary"
                            fullWidth={false}
                            onClick={async () => {
                              await navigator.clipboard.writeText(shareUrl);
                              setCopied(true);
                              toast.success(tc("copied"));
                              setTimeout(() => setCopied(false), 2000);
                            }}
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
                      </>
                    )}
                  </div>
                </GlassCard>
              )}

              {canCancel && (
                <Button
                  variant="danger"
                  onClick={handleCancel}
                  loading={actionLoading === "cancel"}
                >
                  {actionLoading === "cancel" ? t("cancelling") : t("cancelVS")}
                </Button>
              )}
            </div>
          </AnimatedItem>
        ) : (
          <AnimatedItem>
            <GlassCard
              glass
              glow="none"
              noPad
              className="!rounded-2xl !border-2 !border-dashed !border-white/[0.18] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
            >
              <div className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-4">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] text-pv-muted"
                    aria-hidden
                  >
                    <FlaskConical size={18} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                        {t("sampleModeTitle")}
                      </h3>
                      <span className="inline-flex shrink-0 rounded border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-pv-muted sm:text-[10px] sm:tracking-[0.22em]">
                        {t("sampleModeDemoBadge")}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-pv-muted sm:text-xs">
                      {t("sampleModeBody")}
                    </p>
                    <div className="pt-0.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          fullWidth={false}
                          onClick={() => {
                            setDesignLifecycleStep(4);
                            setDesignResolvedOutcome("creator");
                          }}
                          className="w-full !border-white/[0.1] !bg-white/[0.03] !py-2 !px-3 !text-[10px] !font-semibold !text-pv-muted !shadow-none hover:!border-white/[0.16] hover:!bg-white/[0.05] hover:!text-pv-text sm:w-auto sm:!px-3.5 sm:!text-[11px]"
                        >
                          {tBadges("cancelled")}
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          fullWidth={false}
                          onClick={() => {
                            setDesignLifecycleStep(3);
                            setDesignResolvedOutcome((prev) =>
                              prev === "challengers" ? "creator" : "challengers"
                            );
                          }}
                          className="w-full !border-white/[0.1] !bg-white/[0.03] !py-2 !px-3 !text-[10px] !font-semibold !text-pv-muted !shadow-none hover:!border-white/[0.16] hover:!bg-white/[0.05] hover:!text-pv-text sm:w-auto sm:!px-3.5 sm:!text-[11px]"
                        >
                          {designResolvedOutcome === "challengers"
                            ? tBadges("lost")
                            : tBadges("won")}
                        </Button>

                        <Link
                          href="/vs/create"
                          className="inline-block w-full sm:w-auto"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            fullWidth={false}
                            className="w-full !border-white/[0.1] !bg-white/[0.03] !py-2 !px-3 !text-[10px] !font-semibold !text-pv-muted !shadow-none hover:!border-white/[0.16] hover:!bg-white/[0.05] hover:!text-pv-text sm:w-auto sm:!px-3.5 sm:!text-[11px]"
                          >
                            {t("sampleModeCTA")}
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          </AnimatedItem>
        )}
          </div>

          <aside className="min-w-0 lg:col-span-4 text-pv-text">
            <AnimatedItem>
              <div className="flex flex-col gap-6 lg:sticky lg:top-24">
                {(display.state === "open" || display.state === "accepted") && (
                  <ClaimStrengthCard
                    input={{
                      question: display.question,
                      creator_position: display.creator_position,
                      opponent_position: display.opponent_position,
                      resolution_url: display.resolution_url,
                      settlement_rule: display.settlement_rule ?? "",
                      category: display.category,
                      deadline: display.deadline,
                    }}
                  />
                )}
                <VsChallengersCard
                  challengers={challengers}
                  counterPosition={display.counter_position ?? ""}
                  address={address}
                  challengerCount={challengerCount}
                  maxChallengers={maxChallengers}
                  showLoadMore={isSampleVS && designLifecycleStep !== null}
                />
                {showRivalrySection && (
                  <AnimatedItem>
                    <GlassCard
                      glass
                      noPad
                      className="!rounded-2xl border border-white/[0.12]"
                    >
                      <div className="p-5 sm:p-6">
                        <div className="mb-4 flex flex-col gap-3 sm:mb-5">
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-3">
                              <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald/85">
                                {t("rivalry")}
                              </h2>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-pv-muted sm:mt-3">
                              {t("rivalryHint")}
                            </p>
                          </div>

                          {!isSampleVS &&
                            (vs.state === "resolved" || vs.state === "cancelled") && (
                              <div className="w-full flex justify-center">
                                <Link href={`/vs/create?rematch=${vs.id}`}>
                                  <Button
                                    variant="emerald"
                                    fullWidth={false}
                                    size="sm"
                                  >
                                    {t("createRematch")}
                                  </Button>
                                </Link>
                              </div>
                            )}
                        </div>

                        {!isRivalryDataReady || rivalryLoading ? (
                          <div className="rounded-xl border border-white/[0.08] bg-pv-bg/30 p-4 sm:p-5">
                            <p className="text-sm text-pv-muted">{tc("loading")}</p>
                          </div>
                        ) : rivalryChain.length > 1 ? (
                          <div className="rounded-xl border border-white/[0.08] bg-pv-bg/30 p-4 sm:p-5">
                            <div className="space-y-3">
                              {visibleRivalryChain.map((entry, index) => {
                                const inner = (
                                  <div
                                    className={`${RIVALRY_ITEM_BASE_CLASS} ${
                                      entry.id === vs.id
                                        ? RIVALRY_ITEM_ACTIVE_CLASS
                                        : "border-white/[0.1]"
                                    }`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                      <div className="flex items-center gap-2 text-pv-muted text-[10px] font-bold uppercase tracking-[0.14em]">
                                        <GitBranch size={12} />
                                        {t("roundLabel", {
                                          round: index + 1,
                                        })}
                                      </div>
                                      <Badge status={entry.state} compact />
                                    </div>
                                    <div className="font-semibold text-[14px] leading-snug sm:text-[15px]">
                                      {entry.question}
                                    </div>
                                    <div className="text-xs text-pv-muted mt-1">
                                      {t("pool")}: {getVSTotalPot(entry)} GEN
                                    </div>
                                  </div>
                                );

                                return isSampleVS ? (
                                  <div key={entry.id} className="block">
                                    {inner}
                                  </div>
                                ) : (
                                  <Link
                                    key={entry.id}
                                    href={`/vs/${entry.id}`}
                                    className="block"
                                  >
                                    {inner}
                                  </Link>
                                );
                              })}
                            </div>

                            {canLoadMoreRivalry ? (
                              <div className="pt-3 text-center">
                                <button
                                  type="button"
                                  aria-expanded={isRivalryExpanded}
                                  onClick={() => setIsRivalryExpanded(true)}
                                  className="inline-flex items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.01] px-3 py-2 text-xs font-semibold text-pv-muted transition-[background-color,border-color] hover:border-white/[0.1] hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/25"
                                >
                                  Load more
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/[0.14] bg-pv-bg/30 p-4 text-center sm:p-5">
                            <p className="text-sm leading-relaxed text-pv-muted">
                              {t("rivalryEmpty")}
                            </p>
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </AnimatedItem>
                )}
              </div>
            </AnimatedItem>
          </aside>
        </div>
        </div>
        </div>
      </PageTransition>
    </>
  );
}
