"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  getVSSingleWinnerPayout,
  getVSTotalPot,
  getUserVSDirect,
  hasVSWinner,
  hasZeroAddressWinner,
  isVSJoinable,
  isVSPrivate,
  isVSMultiChallengerWin,
  requestResolveVS,
  resetVSResolveRequest,
  type ClaimChallenger,
  type VSData,
} from "@/lib/contract";
import { createChainPublicClient } from "@/lib/arc";
import {
  chainFromQuery,
  explorerTxUrl,
  getChain,
  supportsRematch,
  vsPath,
  type ChainKey,
} from "@/lib/chains";
import ChainBadge from "@/components/ui/ChainBadge";
import NetworkNotice from "@/components/vs/NetworkNotice";
import { getPendingVS } from "@/lib/pending-vs";
import { openPeepsAvatar } from "@/lib/avatars";
import { formatUsdc } from "@/lib/money";
import { acquireTxLock } from "@/lib/tx-lock";
import {
  MIN_STAKE,
  ZERO_ADDRESS,
  getShareUrl,
  shortenAddress,
} from "@/lib/constants";
import { useCountdown } from "@/lib/hooks";
import {
  getStoredPrivateInviteKey,
  rememberPrivateInviteKey,
} from "@/lib/private-links";
import { toast } from "sonner";
import { txErrorMessage } from "@/lib/tx-errors";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import {
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
import CouncilVoteWidget from "@/components/council/CouncilVoteWidget";
import Stage from "@/components/Stage";
import LiveDeadline from "@/components/LiveDeadline";
import { BlueprintHeading } from "@/components/BlueprintGrid";
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
  GitBranch,
  Share2,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import MarketPricePanel from "@/components/vs/MarketPricePanel";
import PriceCrossCheckNote from "@/components/vs/PriceCrossCheckNote";

/** Misma silueta que la píldora «{addr} challenges you» (fucsia, pill redondeada). */
const DUEL_STATUS_FUCHSIA_PILL_CLASS =
  "inline-flex max-w-full min-w-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.08] px-2.5 py-1 text-left text-[11px] font-semibold leading-tight text-pv-fuch shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:px-3 sm:py-1.5 sm:text-xs";

const RIVALRY_ITEM_BASE_CLASS =
  "rounded-xl border p-4 transition-[border-color,background-color] duration-200 bg-pv-bg/30 hover:border-white/[0.22] hover:bg-pv-bg/35";
const RIVALRY_ITEM_ACTIVE_CLASS =
  "border-pv-emerald/[0.35] bg-pv-emerald/[0.08] hover:border-pv-emerald/[0.45] hover:bg-pv-emerald/[0.12]";

function ProgressBar({ canonicalState }: { canonicalState: string }) {
  const t = useTranslations("vsDetail");
  const steps = [
    t("progressCreated"),
    t("progressAccepted"),
    t("progressVerifying"),
    t("progressProven"),
  ];
  const total = steps.length;

  const stepIndex =
    canonicalState === "open"
      ? 0
      : canonicalState === "accepted"
        ? 1
        : canonicalState === "resolved"
          ? 3
          : canonicalState === "cancelled"
            ? -1
            : 0;

  if (canonicalState === "cancelled" || stepIndex === -1) {
    return null;
  }

  const isResolved = stepIndex >= 3;
  const progressPercent = isResolved ? 100 : ((stepIndex + 1) / total) * 100;
  const phaseCurrent = isResolved ? total : stepIndex + 1;

  const cellClass = (isCurrent: boolean, isDone: boolean) =>
    `flex h-full min-h-[4.5rem] w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-all duration-300 sm:min-h-0 sm:py-3.5 ${
      isCurrent
        ? "border-pv-emerald/40 bg-pv-emerald/[0.07] shadow-glow-emerald"
        : isDone
          ? "border-pv-emerald/20 bg-pv-emerald/[0.04]"
          : "border-white/[0.06] bg-pv-bg/40"
    }`;

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
                <div className={cellClass(isCurrent, isDone)}>{inner}</div>
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

const CHALLENGERS_PAGE_SIZE = 4;

/** Toast options naming the tx hash, with a link to it on the claim's explorer. */
function txToastOptions(
  result: {
    txHash?: string | null;
  },
  chain: ChainKey,
): { description: string; action: { label: string; onClick: () => void } } | undefined {
  // explorerTxHash is a full explorer URL now (lib/contract); only txHash is a hash.
  const hash = result.txHash;
  return hash
    ? {
        description: `Tx: ${hash.slice(0, 10)}...${hash.slice(-8)}`,
        action: {
          label: "Explorer",
          onClick: () => window.open(explorerTxUrl(chain, hash), "_blank", "noopener,noreferrer"),
        },
      }
    : undefined;
}

// On-chain refresh cadence; the loading spinner gives up after
// MAX_FETCH_ATTEMPTS * VS_POLL_INTERVAL_MS (~2 min).
const VS_POLL_INTERVAL_MS = 10_000;
const MAX_FETCH_ATTEMPTS = 12;
// How long the verdict overlay / seal stamp stays on screen.
const VERDICT_OVERLAY_MS = 4000;
// Resolution terminal types line by line; phases advance on this cadence and
// the overlay stays up for the full animation even if the tx confirms sooner.
const RESOLVE_PHASE_MS = [2600, 4600, 6500, 8400] as const;
const RESOLVE_ANIM_TOTAL_MS = 9600;

function VsChallengersCard({
  challengers,
  counterPosition,
  address,
  challengerCount,
  maxChallengers,
  className = "border border-white/[0.12] !rounded-2xl",
}: {
  challengers: ClaimChallenger[];
  counterPosition: string;
  address: string | null | undefined;
  challengerCount: number;
  maxChallengers: number;
  className?: string;
}) {
  const t = useTranslations("vsDetail");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [challengers.length]);

  const pageCount = Math.max(1, Math.ceil(challengers.length / CHALLENGERS_PAGE_SIZE));
  const normalizedPage = Math.min(page, pageCount - 1);
  const visibleChallengers = challengers.slice(
    normalizedPage * CHALLENGERS_PAGE_SIZE,
    normalizedPage * CHALLENGERS_PAGE_SIZE + CHALLENGERS_PAGE_SIZE,
  );
  const hasPagination = challengers.length > CHALLENGERS_PAGE_SIZE;

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
            <ul className="min-h-[15.5rem] max-h-[18rem] space-y-2 overflow-y-auto pr-1 sm:space-y-2.5" role="list">
              {visibleChallengers.map((challenger, index) => (
                <li key={`${challenger.address}-${normalizedPage}-${index}`}>
                  <div className="rounded-lg border border-white/[0.08] bg-gradient-to-br from-pv-fuch/[0.04] via-transparent to-transparent p-2.5 transition-[border-color,background-color] duration-200 hover:border-white/[0.14] sm:p-3">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2.5 md:gap-3">
                      <div className="relative size-9 shrink-0 sm:size-10" aria-hidden>
                        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-pv-fuch/[0.32] bg-pv-surface2 shadow-[inset_0_0_18px_rgba(255,255,255,0.03)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={openPeepsAvatar(`challenger-${challenger.address}`)}
                            alt=""
                            className="h-full w-full object-cover object-top opacity-95"
                          />
                        </div>
                        <span className="absolute -bottom-1 -right-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full border border-pv-bg bg-pv-fuch px-1 font-mono text-[8px] font-bold tabular-nums leading-none text-pv-bg shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
                          {normalizedPage * CHALLENGERS_PAGE_SIZE + index + 1}
                        </span>
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
                      <div className="flex min-w-0 flex-col gap-1 justify-self-end sm:justify-self-start">
                        <div
                          className="flex min-h-7 min-w-[4.5rem] items-center justify-center rounded-md border border-white/[0.1] bg-pv-bg/55 px-2 py-1 font-mono text-[9px] font-bold tabular-nums leading-none text-pv-fuch sm:min-h-8 sm:min-w-[5rem] sm:text-[10px]"
                          title={t("challengerStake")}
                        >
                          {formatUsdc(challenger.stake)}
                        </div>
                        <div
                          className="flex min-h-7 min-w-[4.5rem] items-center justify-center rounded-md border border-pv-emerald/[0.18] bg-pv-emerald/[0.08] px-2 py-1 font-mono text-[9px] font-bold tabular-nums leading-none text-pv-emerald sm:min-h-8 sm:min-w-[5rem] sm:text-[10px]"
                          title={t("potentialPayout")}
                        >
                          {formatUsdc(challenger.potential_payout)}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {hasPagination ? (
              <div className="flex items-center justify-between gap-3 pt-3">
                <button
                  type="button"
                  aria-label="Previous challengers"
                  disabled={normalizedPage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-pv-muted transition-[background-color,border-color,color] hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-pv-text disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {"<"}
                </button>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-pv-muted">
                  {normalizedPage + 1}/{pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Next challengers"
                  disabled={normalizedPage >= pageCount - 1}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-bold text-pv-muted transition-[background-color,border-color,color] hover:border-white/[0.14] hover:bg-white/[0.04] hover:text-pv-text disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {">"}
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
  const inviteFromUrl = searchParams.get("invite")?.trim() ?? "";
  // A claim lives on one chain (absent ?chain= means Arc). It wins over the
  // header selection for everything on this page.
  const chain = chainFromQuery(searchParams.get("chain"));
  const { address, isConnected, connect, isOnChain, switchNetwork } = useWallet();
  const tNet = useTranslations("network");
  const [switchingNetwork, setSwitchingNetwork] = useState(false);
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
  /** Tracks whether a resolve tx was fired so we can reveal the verdict once the state arrives. */
  const pendingResolveRef = useRef(false);
  const attemptedFinalizeResolveTxRef = useRef<string | null>(null);
  const [pendingResolveTxHash, setPendingResolveTxHash] = useState<string | null>(null);
  const [, setHasAttemptedResolve] = useState(false);

  const countdown = useCountdown(vs?.deadline || 0);

  const inviteKey = inviteFromUrl || storedInviteKey;

  useEffect(() => {
    pendingResolveRef.current = false;
    attemptedFinalizeResolveTxRef.current = null;
    setPendingResolveTxHash(null);
    setHasAttemptedResolve(false);
  }, [vsId]);

  useEffect(() => {
    if (inviteFromUrl) {
      rememberPrivateInviteKey(vsId, inviteFromUrl, chain);
      setStoredInviteKey(inviteFromUrl);
      return;
    }

    setStoredInviteKey(getStoredPrivateInviteKey(vsId, chain));
  }, [chain, inviteFromUrl, vsId]);

  const fetchVS = useCallback(async () => {
    let data: VSData | null;
    try {
      data = await getVS(vsId, {
        inviteKey,
        viewerAddress: address ?? undefined,
        chain,
      });
    } catch {
      // Transient (429/5xx): keep what is on screen and let the next poll retry.
      setFetchAttempts((prev) => {
        const next = prev + 1;
        if (next >= MAX_FETCH_ATTEMPTS) setLoading(false);
        return next;
      });
      return;
    }
    if (data) {
      setVS(data);
      setLoading(false);
      setFetchAttempts(0);
    } else {
      // Show optimistic data from localStorage while consensus is pending
      const pending = getPendingVS(vsId, chain);
      if (pending) {
        setVS(pending);
        setLoading(false);
      }
      // Keep polling — once on-chain data arrives it replaces the pending item.
      // Give up on the loading spinner after ~2 min.
      setFetchAttempts((prev) => {
        const next = prev + 1;
        if (next >= MAX_FETCH_ATTEMPTS) setLoading(false);
        return next;
      });
    }
  }, [address, chain, inviteKey, vsId]);

  useEffect(() => {
    fetchVS();

    const intervalId = setInterval(fetchVS, VS_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchVS]);

  useEffect(() => {
    if (!vs || vs.state !== "resolved" || !pendingResolveRef.current) {
      return;
    }

    pendingResolveRef.current = false;
    attemptedFinalizeResolveTxRef.current = null;
    setPendingResolveTxHash(null);
    setHasAttemptedResolve(false);
    setShowVerdict(true);

    const timer = setTimeout(() => setShowVerdict(false), VERDICT_OVERLAY_MS);
    return () => clearTimeout(timer);
  }, [vs]);

  useEffect(() => {
    if (!pendingResolveTxHash) {
      return;
    }

    let cancelled = false;
    const resolveTxHash = pendingResolveTxHash as `0x${string}`;

    async function watchResolveTransaction() {
      // Every supported chain finalises fast enough to just wait for the EVM receipt.
      const client = createChainPublicClient(chain);
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
  }, [address, chain, fetchVS, pendingResolveTxHash, t]);

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
    if (!vs) return;

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
        const ids = await getRivalryChain(currentVsId, chain);
        if (cancelled) return;

        if (ids.length === 0) {
          setRivalryChain([]);
          return;
        }

        // Rematches share their parent's chain, so every round lives on `chain`.
        const items = await Promise.all(ids.map((id) => getVS(id, { chain })));
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
  }, [chain, vs?.id, vs?.state]);

  useEffect(() => {
    // Para mantener coherencia visual, colapsamos el rematch list cuando cambia la data.
    setIsRivalryExpanded(false);
  }, [vs?.id, rivalryChain.length]);

  const visibleRivalryChain =
    rivalryChain.length > 2 && !isRivalryExpanded
      ? rivalryChain.slice(0, 2)
      : rivalryChain;
  const canLoadMoreRivalry = rivalryChain.length > 2 && !isRivalryExpanded;
  const isRivalryDataReady =
    rivalryLoadedForVsId !== null && rivalryLoadedForVsId === vs?.id;

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

  const display = vs;

  const isCreator = address?.toLowerCase() === vs.creator.toLowerCase();
  const isOpponent = didUserChallengeVS(display, address);
  const isPrivateVS = isVSPrivate(vs);
  const missingPrivateInvite = isPrivateVS && !inviteKey && !isCreator && !isOpponent;
  const canAccept =
    !missingPrivateInvite &&
    isVSJoinable(vs, address) &&
    isConnected;
  const canCancel = vs.state === "open" && isCreator;
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
    display.state === "accepted" &&
    countdown.expired &&
    isConnected &&
    isParticipant &&
    !userRequestedResolve;
  const canResetResolveRequest =
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
  const winnerTitle = !hasWinner
    ? tStamp("draw")
    : display.winner_side === "challengers" &&
        (isVSMultiChallengerWin(display) || hasZeroAddressWinner(display))
      ? "Challengers won"
      : tStamp("won", { address: shortenAddress(display.winner) });
  const winnerAmountLabel =
    !hasWinner
      ? null
      : resolvedPayout === null
        ? formatUsdc(pool)
        : `+${formatUsdc(resolvedPayout)}`;
  const marketType = display.market_type ?? "binary";
  const oddsMode = display.odds_mode ?? "pool";
  const challengeStakeValue = Number(challengeStake);
  const hasValidChallengeStake =
    Number.isFinite(challengeStakeValue) && challengeStakeValue >= MIN_STAKE;
  const fixedPayoutPreview =
    oddsMode === "fixed" &&
    hasValidChallengeStake &&
    typeof display.challenger_payout_bps === "number" &&
    display.challenger_payout_bps > 0
      ? Math.floor((challengeStakeValue * display.challenger_payout_bps) / 10000)
      : null;
  const creatorStake = display.creator_stake ?? display.stake_amount;
  const challengerStake = display.total_challenger_stake ?? 0;
  const poolPreview =
    oddsMode === "pool" && hasValidChallengeStake
      ? {
          challengerPayout:
            challengeStakeValue +
            (creatorStake > 0
              ? (challengeStakeValue * creatorStake) /
                (challengerStake + challengeStakeValue)
              : 0),
          creatorPayout: pool + challengeStakeValue,
          totalChallengerStake: challengerStake + challengeStakeValue,
        }
      : null;
  const challengePayoutPreview =
    fixedPayoutPreview ??
    (poolPreview ? poolPreview.challengerPayout : null);
  const challengeProfitPreview =
    challengePayoutPreview !== null
      ? Math.max(0, challengePayoutPreview - challengeStakeValue)
      : null;
  const creatorPayoutPreview = hasValidChallengeStake
    ? pool + challengeStakeValue
    : pool;
  const showRivalrySection =
    rivalryChain.length > 1 || display.state === "resolved";
  const shareUrl = getShareUrl(vsId, inviteKey, chain);
  const claimNetwork = getChain(chain);
  // Stake actions need the wallet on the claim's chain; the button switches first.
  const needsNetworkSwitch = isConnected && !isOnChain(chain);

  async function handleSwitchToClaimChain() {
    setSwitchingNetwork(true);
    try {
      await switchNetwork(chain);
    } catch {
      toast.error(tNet("switchFailed", { name: claimNetwork.name }));
    } finally {
      setSwitchingNetwork(false);
    }
  }

  const switchNetworkButton = (className = "") => (
    <Button
      variant="primary"
      onClick={handleSwitchToClaimChain}
      loading={switchingNetwork}
      disabled={switchingNetwork}
      className={className}
    >
      {switchingNetwork ? tNet("switching") : tNet("switchTo", { name: claimNetwork.name })}
    </Button>
  );

  /**
   * Shared guard for every on-chain action: wallet connected, one tx at a
   * time (tab-wide lock), and actionLoading reset when the action finishes.
   */
  async function withTxLock(run: () => Promise<void>): Promise<void> {
    if (!isConnected || !address) {
      return;
    }
    let releaseLock: (() => void) | undefined;
    try {
      releaseLock = acquireTxLock(address);
    } catch (lockErr: any) {
      toast.error(lockErr.message);
      return;
    }
    try {
      await run();
    } finally {
      releaseLock?.();
      setActionLoading(null);
    }
  }

  async function handleAccept() {
    if (!isConnected || !address) {
      return;
    }
    if (!hasValidChallengeStake) {
      toast.error(t("invalidChallengeStakeMin", { amount: MIN_STAKE }));
      return;
    }

    await withTxLock(async () => {
    flushSync(() => {
      setActionLoading("accept");
    });
    try {
      const liveVS = await getVS(vsId, {
        inviteKey,
        viewerAddress: address,
        chain,
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

      const result = await acceptVS(address!, vsId, challengeStakeValue, inviteKey, chain);
      const isPending = "pending" in result && Boolean(result.pending);

      toast.success(
        isPending
          ? t("submittedPending")
          : t("joinedToast", {
              amount: challengeStakeValue,
              total: getVSTotalPot(liveVS) + challengeStakeValue,
            }),
        txToastOptions(result, chain)
      );
      fetchVS();
    } catch (err: any) {
      toast.error(txErrorMessage(err, t("errorAccepting")));
    }
    });
  }

  async function handleResolve() {
    await withTxLock(async () => {
    setActionLoading("resolve");
    if (willTriggerResolution) {
      setResolvePhase(0);
    }

    // La terminal escribe letra por letra (muy lento). Sincronizamos el avance de fase
    // para que se puedan ver TODAS las líneas (incl. "Fetching results..." y "Issuing verdict").
    // Si el tx on-chain tarda menos, mantenemos la terminal visible hasta terminar la animación.
    const phaseTimers = willTriggerResolution
      ? RESOLVE_PHASE_MS.map((ms, i) => setTimeout(() => setResolvePhase(i + 1), ms))
      : [];
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
        txToastOptions(result, chain)
      );

      if (willTriggerResolution && isPending) {
        // Consensus hasn't finished — don't reveal the verdict yet.
        // A useEffect watches vs.state and will auto-reveal once the
        // data transitions to "resolved" (with a winner).
        pendingResolveRef.current = true;
        setPendingResolveTxHash(result.txHash || null);
      } else if (willTriggerResolution) {
        setPendingResolveTxHash(null);
        setShowVerdict(true);
        setTimeout(() => setShowVerdict(false), VERDICT_OVERLAY_MS);
      } else {
        setPendingResolveTxHash(null);
      }
      void fetchVS();

      // Asegura que la terminal tenga tiempo de mostrar la última línea aunque la tx
      // se confirme rápido.
      const elapsed = Date.now() - startedAt;
      if (willTriggerResolution && elapsed < RESOLVE_ANIM_TOTAL_MS) {
        await new Promise((r) => setTimeout(r, RESOLVE_ANIM_TOTAL_MS - elapsed));
      }
    } catch (err: any) {
      toast.error(txErrorMessage(err, t("errorResolving")));
    } finally {
      phaseTimers.forEach(clearTimeout);
      if (willTriggerResolution) {
        setResolvePhase(-1);
      }
    }
    });
  }

  async function handleResetResolveRequest() {
    await withTxLock(async () => {
    setActionLoading("resetResolve");
    try {
      const result = await resetVSResolveRequest(address!, vsId, inviteKey);
      toast.success(t("resetResolveRequestSuccess"), txToastOptions(result, chain));
      void fetchVS();
    } catch (err: any) {
      toast.error(txErrorMessage(err, t("resetResolveRequestError")));
    }
    });
  }

  async function handleCancel() {
    await withTxLock(async () => {
    setActionLoading("cancel");
    try {
      const result = await cancelVS(address!, vsId, inviteKey, chain);
      const isPending = "pending" in result && Boolean(result.pending);
      toast.success(
        isPending ? t("submittedPending") : t("cancelledToast"),
        txToastOptions(result, chain)
      );
      fetchVS();
    } catch (err: any) {
      toast.error(txErrorMessage(err, t("errorCancelling")));
    }
    });
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
              className="font-display text-[clamp(3rem,15vw,8rem)] font-bold uppercase text-pv-emerald drop-shadow-[0_0_40px_rgba(51,79,169,0.4)]"
            >
              SETTLED.
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
        <div className="relative z-[1] mx-auto w-full max-w-[1280px] px-4 pb-16 sm:px-6 sm:pb-20">
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
          <div className="mb-6 -mx-4 sm:mb-8 sm:-mx-6">
            <BlueprintHeading>{t("heroLead")}</BlueprintHeading>
            <p className="mt-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
              {t("subtitle")}
            </p>
          </div>
        </AnimatedItem>

        {vs.state !== "cancelled" && (
          <AnimatedItem>
            <ProgressBar canonicalState={vs.state} />
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
              />
            </AnimatedItem>
            <AnimatedItem>
              <div className="mb-6 sm:mb-8">
                <SettlementExplanationCard vs={display} />
              </div>
            </AnimatedItem>
          </>
        )}

        {vsId > 0 && (
          <AnimatedItem>
            <div className="mb-6 sm:mb-8">
              <CouncilVoteWidget claimId={vsId} chain={chain} />
            </div>
          </AnimatedItem>
        )}

        {actionLoading === "resolve" && willTriggerResolution && (
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
                  <span className="inline-flex items-center gap-2">
                    <ChainBadge chain={chain} />
                    <span className="font-mono text-[11px] text-pv-muted">#{vs.id}</span>
                  </span>
                </div>

                <h2 className="mb-6 font-display text-[clamp(28px,8.5vw,46px)] font-bold leading-[0.92] tracking-tight sm:mb-7">
                  {display.question}
                </h2>

                <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-white/[0.12] sm:flex-row">
                  <div className="flex-1 p-4 bg-pv-cyan/[0.04]">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-pv-cyan/35 bg-pv-surface2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={openPeepsAvatar(`creator-${display.creator}`)}
                          alt=""
                          className="h-full w-full object-cover object-top opacity-95"
                        />
                      </div>
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
                          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-pv-fuch/35 bg-pv-surface2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={openPeepsAvatar(`challenger-${display.opponent}`)}
                              alt=""
                              className="h-full w-full object-cover object-top opacity-95"
                            />
                          </div>
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

                <MarketPricePanel vs={display} />

                {/* Métricas: mobile-first — 1 col → 2 (sm) → 4 (lg); panel unificado + celdas con min-h táctil */}
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/[0.1] bg-white/[0.07] p-px shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:grid-cols-2 lg:grid-cols-4">
                  {/* Misma estructura en las 4: título arriba (shrink-0) + valor abajo (mt-auto) para alinear filas */}
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("pool")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-gold sm:text-lg lg:text-xl">
                      {formatUsdc(pool)}
                    </div>
                  </div>
                  <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem] sm:px-4 sm:py-4">
                    <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                      {t("creatorStake")}
                    </p>
                    <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-cyan sm:text-lg lg:text-xl">
                      {formatUsdc(display.creator_stake ?? display.stake_amount)}
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

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.08] px-5 py-3 sm:px-8">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(51,79,169,0.6)]" />
                    <span className="text-xs text-pv-muted">{t("provenVerifies")}</span>
                  </div>
                  <PriceCrossCheckNote
                    question={display.question}
                    settlementRule={display.settlement_rule}
                  />
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,12rem)] sm:items-end">
                      <Input
                        label={t("challengeStake")}
                        type="number"
                        min={MIN_STAKE}
                        step="1"
                        value={challengeStake}
                        onChange={(event) => setChallengeStake(event.target.value)}
                        className="h-[3.25rem]"
                      />
                      {needsNetworkSwitch ? (
                        switchNetworkButton("h-[3.25rem] w-full")
                      ) : (
                        <Button
                          variant="fuch"
                          onClick={handleAccept}
                          loading={actionLoading === "accept"}
                          disabled={!hasValidChallengeStake}
                          className="h-[3.25rem] w-full"
                        >
                          {actionLoading === "accept"
                            ? t("accepting")
                            : t("acceptAndStake", {
                                amount: hasValidChallengeStake ? challengeStakeValue : vs.stake_amount,
                              })}
                        </Button>
                      )}
                    </div>
                    <NetworkNotice
                      chain={chain}
                      note={tNet("claimOnNetwork", { name: claimNetwork.name })}
                      className="mt-4"
                    />
                    {challengePayoutPreview !== null && challengeProfitPreview !== null && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.1] bg-pv-bg/35">
                        <div className="grid grid-cols-1 gap-px bg-white/[0.07] p-px sm:grid-cols-3">
                          <div className="min-w-0 bg-pv-bg/70 px-3.5 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                              {t("ifChallengersWin")}
                            </div>
                            <div className="mt-1.5 font-mono text-sm font-bold tabular-nums text-pv-emerald sm:text-base">
                              {formatUsdc(challengePayoutPreview)}
                            </div>
                          </div>
                          <div className="min-w-0 bg-pv-bg/70 px-3.5 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                              {t("netProfit")}
                            </div>
                            <div className="mt-1.5 font-mono text-sm font-bold tabular-nums text-pv-fuch sm:text-base">
                              +{formatUsdc(challengeProfitPreview)}
                            </div>
                          </div>
                          <div className="min-w-0 bg-pv-bg/70 px-3.5 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                              {t("ifCreatorWins")}
                            </div>
                            <div className="mt-1.5 font-mono text-sm font-bold tabular-nums text-pv-cyan sm:text-base">
                              {formatUsdc(poolPreview?.creatorPayout ?? creatorPayoutPreview)}
                            </div>
                          </div>
                        </div>
                        {poolPreview ? (
                          <p className="px-3.5 py-3 text-xs leading-relaxed text-pv-muted">
                            {t("poolPayoutFormula", {
                              stake: formatUsdc(challengeStakeValue),
                              creatorStake: formatUsdc(creatorStake),
                              challengerStake: formatUsdc(poolPreview.totalChallengerStake),
                            })}
                          </p>
                        ) : null}
                      </div>
                    )}
                    <p className="text-xs text-pv-muted mt-3">
                      {fixedPayoutPreview !== null
                        ? t("challengeStakeHintFixed", { payout: fixedPayoutPreview })
                        : t("challengeStakeHintPool")}
                    </p>
                    <p className="text-xs text-pv-muted mt-2">
                      {t("minimumStakeHint", { amount: MIN_STAKE })}
                    </p>
                </GlassCard>
              )}

              {vs.state === "open" && !isConnected && !countdown.expired && (
                <Button onClick={connect}>{t("connectToAccept")}</Button>
              )}

              {vs.state === "open" &&
                !hasAnyChallenger &&
                countdown.expired && (
                <GlassCard glass className="!rounded-2xl border border-white/[0.12]">
                  <div className="text-sm font-semibold text-pv-text">
                    {t("expiredNoRivalTitle")}
                  </div>
                  <p className="mt-1 text-sm text-pv-muted">
                    {isCreator
                      ? t("expiredNoRivalHintCreator")
                      : t("expiredNoRivalHintViewer")}
                  </p>
                </GlassCard>
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

              {canCancel &&
                (needsNetworkSwitch ? (
                  switchNetworkButton()
                ) : (
                  <Button
                    variant="danger"
                    onClick={handleCancel}
                    loading={actionLoading === "cancel"}
                  >
                    {actionLoading === "cancel" ? t("cancelling") : t("cancelVS")}
                  </Button>
                ))}
            </div>
        </AnimatedItem>
          </div>

          <aside className="min-w-0 lg:col-span-4 text-pv-text">
            <AnimatedItem>
              <div className="flex flex-col gap-6 lg:sticky lg:top-24">
                {(display.state === "open" || display.state === "accepted") && (
                  <ClaimStrengthCard
                    className="lg:min-h-[20rem]"
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

                          {supportsRematch(chain) &&
                            (vs.state === "resolved" || vs.state === "cancelled") && (
                              <div className="w-full flex justify-center">
                                <Link
                                  href={`/vs/create?rematch=${vs.id}${chain === "arc" ? "" : `&chain=${chain}`}`}
                                >
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
                                      {t("pool")}: {formatUsdc(getVSTotalPot(entry))}
                                    </div>
                                  </div>
                                );

                                return (
                                  <Link
                                    key={entry.id}
                                    href={vsPath(entry.id, chain)}
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
