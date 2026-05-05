"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getAllVSSnapshot,
  getVSSingleWinnerPayout,
  getVSTotalPot,
  hasVSWinner,
  isVSJoinable,
  type VSData,
} from "@/lib/contract";
import { ZERO_ADDRESS, shortenAddress } from "@/lib/constants";
import { mergePendingVS } from "@/lib/pending-vs";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { Button } from "@/components/ui";
import VSCard from "@/components/VSCard";
import ArenaCard from "@/components/ArenaCard";
import ArenaProposeCard from "@/components/ArenaProposeCard";
import SettlementArchiveSection from "@/components/SettlementArchiveSection";
import Stage from "@/components/Stage";
import Artifact from "@/components/Artifact";
import LiveStat from "@/components/LiveStat";
import { kineticContainer, kineticLetter } from "@/lib/animations/rituals";

type ParsedStat = {
  prefix: string;
  unit: string; // e.g. "M" or "B"
  suffix: string; // e.g. "+" or "%"
  target: number;
  decimals: number;
};

function parseStat(raw: string): ParsedStat | null {
  const trimmed = raw.trim();

  let prefix = "";
  let suffix = "";
  let unit = "";
  let working = trimmed;

  if (working.startsWith("$")) {
    prefix = "$";
    working = working.slice(1);
  }

  if (working.endsWith("%")) {
    suffix = "%";
    working = working.slice(0, -1);
  }

  const m = working.match(/^([0-9]+(?:\.[0-9]+)?)([MB])?(\+)?$/);
  if (!m) return null;

  const numStr = m[1];
  unit = m[2] ?? "";
  const matchSuffix = m[3] ?? "";
  suffix = suffix || matchSuffix;
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;

  return {
    prefix,
    unit,
    suffix,
    target: Number.parseFloat(numStr),
    decimals,
  };
}

function formatStat(current: number, parsed: ParsedStat): string {
  const formattedNumber =
    parsed.decimals > 0 ? current.toFixed(parsed.decimals) : current.toFixed(0);

  return `${parsed.prefix}${formattedNumber}${parsed.unit}${parsed.suffix}`;
}

function AnimatedStatNumber({
  raw,
  delayMs,
}: {
  raw: string;
  delayMs: number;
}) {
  const parsed = useMemo(() => parseStat(raw), [raw]);
  const reducedMotion = useReducedMotion();

  const targetText = useMemo(
    () => (parsed ? formatStat(parsed.target, parsed) : raw),
    [parsed, raw]
  );
  const initialText = useMemo(
    () => (parsed ? formatStat(0, parsed) : raw),
    [parsed, raw]
  );

  const [display, setDisplay] = useState(initialText);
  const ref = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);
  const isInView = useInView(ref, { once: true, amount: 0.05 });

  useEffect(() => {
    if (startedRef.current) return;

    if (!parsed) {
      startedRef.current = true;
      setDisplay(raw);
      return;
    }

    if (reducedMotion) {
      startedRef.current = true;
      setDisplay(targetText);
      return;
    }

    let rafId: number | null = null;
    let timeoutId: number | null = null;
    let fallbackTimeoutId: number | null = null;

    const startAnimation = () => {
      const from = 0;
      const to = parsed.target;
      const durationMs = 1700;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        // Ease-out cubic for a professional, smooth feel.
        const eased = 1 - Math.pow(1 - t, 3);
        const current = from + (to - from) * eased;

        setDisplay(formatStat(current, parsed));

        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          setDisplay(targetText);
        }
      };

      rafId = requestAnimationFrame(tick);
    };

    const trigger = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      timeoutId = window.setTimeout(startAnimation, delayMs);
    };

    // Ideal: iniciar en el momento exacto en que entra al viewport.
    if (isInView) {
      trigger();
      return () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (rafId) window.cancelAnimationFrame(rafId);
      };
    }

    // Fallback mobile: en algunos casos con targets inline y header fijo,
    // IntersectionObserver puede tardar o no disparar con el umbral.
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (!isMobile) return;

    fallbackTimeoutId = window.setTimeout(() => {
      if (startedRef.current) return;
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const within = rect.top < window.innerHeight * 1.05 && rect.bottom > 0;
      if (!within) return;

      trigger();
    }, delayMs + 250);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
      if (fallbackTimeoutId) window.clearTimeout(fallbackTimeoutId);
    };
  }, [delayMs, isInView, parsed, raw, reducedMotion, targetText]);

  useEffect(() => {
    // If the stat text changes (new locale/data), reset and allow replay once.
    startedRef.current = false;
    setDisplay(initialText);
  }, [initialText, raw]);

  return (
    <span ref={ref} aria-label={raw} className="inline-block">
      {display}
    </span>
  );
}

export default function HomePage() {
  const [allVS, setAllVS]     = useState<VSData[]>([]);
  const [loading, setLoading] = useState(true);
  const t  = useTranslations("home");
  const tStamp = useTranslations("stamp");

  const loadVS = useCallback(async ({ showPageLoading = false } = {}) => {
    if (showPageLoading) {
      setLoading(true);
    }

    try {
      const results = await getAllVSSnapshot();
      setAllVS(mergePendingVS(results.items));
    } catch (e) {
      console.error("Failed to load VS:", e);
      setAllVS([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVS({ showPageLoading: true });
  }, [loadVS]);

  const openVS     = allVS.filter((v) => isVSJoinable(v));
  const resolvedVS = allVS.filter((v) => v.state === "resolved");
  const decidedResolvedVS = resolvedVS.filter((v) => hasVSWinner(v));
  const totalGenStaked = allVS.reduce((sum, vs) => sum + getVSTotalPot(vs), 0);
  const fallbackArenaCards = [
    {
      vs: {
        id: -1,
        question: "BTC Price will break $100k before March 31",
        stake_amount: 12,
        opponent: ZERO_ADDRESS,
        category: "crypto",
        state: "open" as const,
        market_type: "binary" as const,
        odds_mode: "pool" as const,
        max_challengers: 1,
      },
      challengersCount: 0,
    },
    {
      vs: {
        id: -2,
        question: "GPT-5 Announced by OpenAI before June",
        stake_amount: 4,
        opponent: ZERO_ADDRESS,
        category: "custom",
        state: "open" as const,
        market_type: "binary" as const,
        odds_mode: "pool" as const,
        max_challengers: 1,
      },
      challengersCount: 0,
    },
    {
      vs: {
        id: -3,
        question: "Lakers win the western conference",
        stake_amount: 8,
        opponent: ZERO_ADDRESS,
        category: "sports",
        state: "open" as const,
        market_type: "binary" as const,
        odds_mode: "pool" as const,
        max_challengers: 1,
      },
      challengersCount: 0,
    },
    {
      vs: {
        id: -4,
        question: "Fed cuts rates before Q3 2026",
        stake_amount: 15,
        opponent: ZERO_ADDRESS,
        category: "custom",
        state: "accepted" as const,
        market_type: "binary" as const,
        odds_mode: "fixed" as const,
        max_challengers: 1,
      },
      challengersCount: 1,
    },
    {
      vs: {
        id: -5,
        question: "Ethereum ETF daily inflows exceed $50M",
        stake_amount: 6,
        opponent: ZERO_ADDRESS,
        category: "crypto",
        state: "resolved" as const,
        market_type: "binary" as const,
        odds_mode: "pool" as const,
        max_challengers: 1,
      },
      challengersCount: 1,
    },
  ];

  const arenaFromData = [...openVS, ...allVS.filter((v) => v.state !== "open")]
    .slice(0, 6)
    .map((vs) => ({ vs, challengersCount: undefined as number | undefined }));
  const arenaMerged = [...arenaFromData, ...fallbackArenaCards];
  const arenaGridCards = arenaMerged.slice(0, 5);

  const steps = [
    {
      icon: null,
      iconSrc: "/icons/handshake-logo.svg",
      title: `1. ${t("stepChallenge").toUpperCase()}`,
      description:
        "Define your terms and lock your stake in the vault. The AI starts watching.",
    },
    {
      icon: null,
      iconSrc: "/icons/letter.svg",
      title: `2. ${t("stepSend").toUpperCase()}`,
      description:
        "Broadcast your link. Call out a specific rival or open it to the public arena.",
    },
    {
      icon: null,
      iconSrc: "/icons/check-circle-logo.svg",
      title: `3. ${t("stepAccept").toUpperCase()}`,
      description:
        "Rival stakes their matching amount. Smart contract activates and locks the pool.",
    },
    {
      icon: null,
      iconSrc: "/icons/verified.svg",
      title: `4. ${t("stepProven").toUpperCase()}`,
      description:
        "Consensus validates the proof, and the winner gets paid on-chain instantly.",
    },
  ];

  return (
    <PageTransition>
      {/* Hero — Manifesto with kinetic typography + arena grid */}
      <AnimatedItem>
        <Stage
          glow="both"
          grid
          className="mb-6 sm:mb-8 relative w-full"
        >
          {/* Full atmospheric backdrop — shifted right so left robot clears the text panel */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            {/* Mobile-first hero image */}
            <div className="relative h-full w-full sm:hidden" style={{ transform: "scaleX(-1)" }}>
              <Image
                src="/HeroMobile-2jpeg.jpeg"
                alt=""
                fill
                priority
                quality={85}
                className="object-cover opacity-[0.62] scale-[1.08] object-[50%_100%]"
                sizes="100vw"
              />
            </div>
            {/* Desktop/tablet hero image */}
            <div className="relative hidden h-full w-full sm:block" style={{ transform: "scaleX(-1)" }}>
              <Image
                src="/Hero.jpg"
                alt=""
                fill
                priority
                quality={85}
                className="object-cover opacity-[0.62] scale-[1.03] object-[58%_23%] sm:object-[56%_23%] lg:object-[54%_21%]"
                sizes="100vw"
              />
            </div>
            {/* Center scrim — keeps text readable without killing the image */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_38%,rgba(14,14,14,0.75)_0%,rgba(14,14,14,0.35)_35%,transparent_68%)]" />

            {/* Feathering on edges: smooth fade so the image never looks "cut" */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-pv-bg/95 via-pv-bg/45 to-transparent sm:h-40" />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-pv-bg via-pv-bg/45 to-transparent sm:w-32" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-pv-bg via-pv-bg/45 to-transparent sm:w-32" />

            {/* Bottom edge fade */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-pv-bg/95 via-pv-bg/45 to-transparent sm:h-28" />
          </div>

          {/* Text panel — centered so the backdrop stays visible */}
          <div className="relative z-10 mx-auto flex min-h-[90vh] w-full max-w-[1200px] items-center justify-center px-4 sm:px-6 lg:px-8 pt-[env(safe-area-inset-top,0px)] sm:min-h-[inherit]">
            <div className="w-full max-w-[640px] pt-14 pb-28 sm:py-16 lg:py-20 text-center">
              {/* Headline — 3 lines, reduced size, payoff line smaller */}
              <motion.h1
                className="mb-6 flex flex-col gap-1 text-center font-display font-bold leading-[0.92] tracking-tight text-pv-text"
                variants={kineticContainer}
                initial="hidden"
                animate="visible"
              >
                {/* Line 1: PROVE IT */}
                <span className="block overflow-hidden text-[clamp(3.4rem,8.5vw,5.2rem)] lg:text-[clamp(3.8rem,5.2vw,5.8rem)]">
                  {["PROVE", "IT"].map((word) => (
                    <motion.span key={word} variants={kineticLetter} className="inline-block mr-[0.25em]">
                      {word}
                    </motion.span>
                  ))}
                </span>
                {/* Line 2: ON-CHAIN. */}
                <span className="block overflow-hidden text-[clamp(3.4rem,8.5vw,5.2rem)] lg:text-[clamp(3.8rem,5.2vw,5.8rem)]">
                  <motion.span variants={kineticLetter} className="inline-block whitespace-nowrap">
                    {t("emptyHeroTitleOnChainSegment")}
                  </motion.span>
                </span>
                {/* Rhythmic pause */}
                <span className="block h-2 lg:h-3" aria-hidden />
                {/* Line 3: WITH PROVEN. — smaller payoff/accent */}
                <span className="block overflow-hidden text-[clamp(2.7rem,7vw,4rem)] lg:text-[clamp(2.8rem,4.5vw,4.2rem)]">
                  <motion.span variants={kineticLetter} className="inline-block mr-[0.25em] font-medium text-pv-muted">
                    {t("emptyHeroTitleLine2Lead")}
                  </motion.span>
                  <motion.span
                    variants={kineticLetter}
                    className="inline-block italic text-pv-emerald drop-shadow-[0_0_18px_rgba(78,222,163,0.5)]"
                  >
                    PROVEN.
                  </motion.span>
                </span>
              </motion.h1>

              <motion.p
                className="mb-5 mx-auto max-w-[460px] text-[13px] leading-relaxed text-pv-muted/90 sm:text-sm lg:text-[15px] lg:leading-7"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                {t("emptyHeroSubtitle")}
              </motion.p>

              <motion.div
                className="flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.58, duration: 0.5 }}
              >
                {/* Secondary CTA — fuchsia neon */}
                <Link
                  href="/explorer"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-fuch/30 bg-transparent px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-fuch/80 transition-all duration-300 hover:border-pv-fuch/60 hover:bg-pv-fuch/[0.1] hover:text-pv-fuch hover:shadow-[0_0_28px_-4px_rgba(248,172,255,0.45),inset_0_0_20px_-8px_rgba(248,172,255,0.12)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-fuch/[0.1] via-transparent to-pv-fuch/[0.05]" />
                  <span className="relative">{t("heroExploreChallenges")}</span>
                </Link>

                {/* Primary CTA — cyan neon */}
                <Link
                  href="/vs/create"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-emerald/40 bg-pv-emerald/[0.08] px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-emerald transition-all duration-300 hover:border-pv-emerald/70 hover:bg-pv-emerald/[0.15] hover:text-white hover:shadow-[0_0_28px_-4px_rgba(78,222,163,0.5),inset_0_0_20px_-8px_rgba(78,222,163,0.15)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-emerald/[0.12] via-transparent to-pv-emerald/[0.06]" />
                  <span className="relative">{t("heroChallengeSomeone")}</span>
                </Link>
              </motion.div>
            </div>
          </div>
        </Stage>
      </AnimatedItem>

      {/* Differentiator — stats strip (total / resolved / GEN staked); mismo patrón que THE PROTOCOL / LIVE ARENA */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
              {t("statsSectionTitle")}
            </h2>
            <div className="h-px flex-1 bg-white/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="p-5 sm:p-6 text-center border border-white/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={allVS.length}
                label={t("totalClaims")}
                labelPosition="below"
                size="lg"
                color="emerald"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
            <div className="p-5 sm:p-6 text-center border border-white/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={resolvedVS.length}
                label={t("resolvedClaims")}
                labelPosition="below"
                size="lg"
                color="emerald"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
            <div className="p-5 sm:p-6 text-center border border-white/[0.06] rounded-xl bg-pv-surface/30">
              <LiveStat
                value={totalGenStaked}
                label={t("genStaked")}
                labelPosition="below"
                size="lg"
                color="gold"
                suffix="GEN"
                  labelClassName="text-[12px]"
                className="items-center"
              />
            </div>
          </div>
        </div>
      </AnimatedItem>

      {/* THE PROTOCOL — layout tipo bento (inspirado en “Market Intelligence” del prototipo) */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
              THE PROTOCOL
            </h2>
            <div className="h-px flex-1 bg-white/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:auto-rows-[minmax(240px,auto)]">
            {steps.map(({ iconSrc, title, description }, index) => {
              const stepLabel = `STEP ${String(index + 1).padStart(2, "0")}`;

              const renderIcon = (sizeClass: string) =>
                iconSrc ? (
                  <span
                    className={`${sizeClass} shrink-0 bg-pv-emerald`}
                    style={{
                      WebkitMaskImage: `url(${iconSrc})`,
                      maskImage: `url(${iconSrc})`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                    }}
                    aria-hidden
                  />
                ) : null;

              /* Fila 1: tile destacado (2 cols) + dos compactas (1+1). Fila 2: barra ancha (4 cols). */
              if (index === 0) {
                return (
                  <div
                    key={title}
                    className="card group relative col-span-1 flex flex-col justify-between overflow-hidden border-white/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-2 md:min-h-[280px]"
                  >
                    <div className="pointer-events-none absolute -right-6 -top-6 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-10 sm:-top-10">
                      {iconSrc ? (
                        <span
                          className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                          style={{
                            WebkitMaskImage: `url(${iconSrc})`,
                            maskImage: `url(${iconSrc})`,
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                          }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="relative z-10 flex min-w-0 flex-1 items-start gap-4 md:items-center">
                      {renderIcon("h-12 w-12 shrink-0 sm:h-14 sm:w-14")}
                      <div className="min-w-0">
                        <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                          {stepLabel}
                        </div>
                        <h3 className="font-display text-xl font-bold leading-tight tracking-tight text-pv-text sm:text-2xl md:text-3xl">
                          {title.replace(/^\d+\.\s*/, "")}
                        </h3>
                        <p className="mt-2 max-w-prose text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                          {description}
                        </p>
                      </div>
                    </div>
                    <div className="relative z-10 mt-6 h-px bg-gradient-to-r from-pv-emerald/40 to-transparent opacity-40" />
                    <div className="relative z-10 mt-4 flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                        Protocol layer
                      </span>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald">
                        Live
                      </span>
                    </div>
                  </div>
                );
              }

              if (index === 1 || index === 2) {
                return (
                  <div
                    key={title}
                    className="card group relative overflow-hidden flex flex-col justify-between border-white/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-1 md:min-h-[280px]"
                  >
                    <div className="pointer-events-none absolute -right-9 -top-6 z-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-13 sm:-top-10">
                      {iconSrc ? (
                        <span
                          className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                          style={{
                            WebkitMaskImage: `url(${
                              index === 1
                                ? "/icons/user.svg"
                                : index === 2
                                  ? "/icons/thumb-up.svg"
                                  : iconSrc
                            })`,
                            maskImage: `url(${
                              index === 1
                                ? "/icons/user.svg"
                                : index === 2
                                  ? "/icons/thumb-up.svg"
                                  : iconSrc
                            })`,
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                          }}
                          aria-hidden
                        />
                      ) : null}
                    </div>
                    <div className="relative z-10">
                      <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                        {stepLabel}
                      </div>
                      <div className="mb-4">{renderIcon("h-10 w-10 sm:h-11 sm:w-11")}</div>
                      <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-pv-text sm:text-xl">
                        {title}
                      </h3>
                    </div>
                    <p className="relative z-10 mt-4 text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                      {description}
                    </p>
                  </div>
                );
              }

              /* index === 3 — barra ancha */
              return (
                <div
                  key={title}
                  className="card group relative col-span-1 overflow-hidden flex flex-col gap-6 border-white/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-4 md:flex-row md:items-center md:justify-between md:gap-10"
                >
                  <div className="pointer-events-none absolute -right-9 -top-6 z-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-13 sm:-top-10">
                    {iconSrc ? (
                      <span
                        className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                        style={{
                          WebkitMaskImage: "url(/icons/verify.svg)",
                          maskImage: "url(/icons/verify.svg)",
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          maskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskSize: "contain",
                        }}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  <div className="relative z-10 flex min-w-0 flex-1 items-start gap-4 md:items-center">
                    {renderIcon("h-11 w-11 shrink-0 sm:h-12 sm:w-12")}
                    <div className="min-w-0">
                      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                        {stepLabel}
                      </div>
                      <h3 className="font-display text-xl font-medium tracking-tighter text-pv-text sm:text-2xl md:text-3xl">
                        {title.replace(/^\d+\.\s*/, "")}
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                        {description}
                      </p>
                    </div>
                  </div>
                  <div className="relative z-10 hidden h-12 w-px shrink-0 bg-white/[0.1] md:block" aria-hidden />
                  <div className="relative z-10 flex shrink-0 flex-col items-start gap-1 md:items-end md:text-right">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                      Settlement
                    </span>
                    <span className="font-display text-lg font-semibold text-pv-emerald sm:text-xl">
                      On-chain
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedItem>

      {/* LIVE ARENA — 3x2 grid of active challenges */}
      {arenaGridCards.length > 0 && (
        <AnimatedItem>
          <div className="mb-12">
            <div className="mb-10 flex items-center gap-4 sm:gap-6">
              <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
                LIVE ARENA
              </h2>
              <div className="h-px flex-1 bg-white/[0.12]" aria-hidden />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {arenaGridCards.map(({ vs, challengersCount }) => (
                <ArenaCard
                  key={vs.id}
                  vs={vs}
                  challengersCount={challengersCount}
                  archiveLabelShort={vs.id === -5}
                  hideClaimStrengthPill
                />
              ))}
              <ArenaProposeCard />
            </div>
          </div>
        </AnimatedItem>
      )}

      {/* THE ARCHIVE — settlement index + terminal (inspirado en “Archive / Odds” editorial) */}
      <AnimatedItem>
        <SettlementArchiveSection allVS={allVS} loading={loading} />
      </AnimatedItem>

      {/* READY TO WIN CTA */}
      <AnimatedItem>
        <div className="mt-16 sm:mt-20 mb-12">
          <div className="group relative w-full overflow-hidden rounded-lg border border-white/[0.12] bg-pv-surface/80 px-6 py-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-10 md:p-12 lg:p-14">
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-[0.14] transition-opacity duration-700 group-hover:opacity-[0.2]"
              aria-hidden
            >
              <div className="h-full w-full bg-gradient-to-l from-pv-emerald/40 via-pv-emerald/10 to-transparent" />
            </div>
            <div
              className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-pv-emerald/20 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10 flex flex-col items-start gap-7 text-left sm:gap-8 md:flex-row md:items-end md:justify-between md:gap-10">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pv-emerald opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-pv-emerald" />
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                    Launch a challenge
                  </span>
                </div>

                <h2 className="font-display text-[clamp(1.9rem,7vw,3.1rem)] font-bold leading-[0.95] tracking-tight text-pv-text">
                  READY TO <span className="text-pv-emerald">WIN?</span>
                </h2>
                <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-pv-muted sm:text-base">
                  Set the terms, lock your stake, and share the link. When the outcome is provable, PROVEN settles it on-chain.
                </p>
              </div>

              <div className="w-full md:w-auto">
                <Link href="/vs/create" className="block w-full md:w-auto">
                  <Button
                    variant="primary"
                    className="w-full md:w-auto px-8 font-display text-xs font-bold uppercase tracking-[0.2em]"
                  >
                    CREATE A CHALLENGE
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </AnimatedItem>


      

      {/* Market Explorer preview — 2 cols en desktop */}
      {openVS.length > 0 && (
        <AnimatedItem>
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(78,222,163,0.6)]" />
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                  {t("marketExplorerTeaser")}
                </span>
              </div>
              <span className="text-[11px] text-pv-muted">
                {t("waitingRival", { count: openVS.length })}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {openVS.slice(0, 4).map((vs) => (
                <VSCard key={vs.id} vs={vs} />
              ))}
            </div>

            {openVS.length > 4 && (
              <Link
                href="/explorer"
                className="block w-full py-3.5 border border-pv-emerald/[0.24] bg-pv-emerald/[0.06] text-center font-display text-sm font-bold text-pv-emerald mt-2.5 hover:bg-pv-emerald/[0.1] transition-colors"
              >
                {t("viewAllOpen", { count: openVS.length })}
              </Link>
            )}
          </div>
        </AnimatedItem>
      )}

      {/* Proof Ledger — recently proven, terminal/document aesthetic */}
      {decidedResolvedVS.length > 0 && (
        <AnimatedItem>
          <Artifact serial="PV-LEDGER" watermark="PROVEN" className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(78,222,163,0.6)]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
                {t("recentlyProven")}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
              {decidedResolvedVS.slice(0, 4).map((vs) => {
                const payout = getVSSingleWinnerPayout(vs);
                const winnerLabel = tStamp("won", { address: shortenAddress(vs.winner) });

                return (
                <Link key={vs.id} href={`/vs/${vs.id}`} className="block group">
                  <motion.div
                    whileHover={{ x: 4 }}
                    className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.06] rounded group-hover:border-pv-emerald/[0.25] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-[10px] text-pv-muted/40 w-8 shrink-0">
                        #{vs.id}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-pv-emerald shrink-0" />
                      <span className="font-mono text-[12px] truncate text-pv-text/80">
                        {winnerLabel}
                      </span>
                    </div>
                    <span className="font-mono text-[12px] font-bold text-pv-gold flex-shrink-0 ml-2">
                      {payout === null ? `${getVSTotalPot(vs)} GEN` : `+${payout} GEN`}
                    </span>
                  </motion.div>
                </Link>
                );
              })}
            </div>
          </Artifact>
        </AnimatedItem>
      )}
    </PageTransition>
  );
}
