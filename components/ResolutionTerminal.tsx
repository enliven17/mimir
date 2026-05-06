"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import GlassCard from "./ui/GlassCard";

interface ResolutionTerminalProps {
  phase: number;
  url: string;
}

export default function ResolutionTerminal({
  phase,
  url,
}: ResolutionTerminalProps) {
  const t = useTranslations("terminal");

  const rawSteps = useMemo(
    () => [
      t("searchingEvidence"),
      t("analyzing", { url }),
      t("comparingSources"),
      t("fetchingResults"),
      t("issuingVerdict"),
    ],
    [t, url],
  );

  type LineInfo = { base: string; hasEllipsis: boolean };
  const lineInfo = useMemo<LineInfo[]>(
    () =>
      rawSteps.map((s, idx) => {
        const isLast = idx === rawSteps.length - 1;
        const endsWithEllipsis = s.endsWith("...");
        const hasEllipsis = endsWithEllipsis || isLast;
        return {
          base: endsWithEllipsis ? s.slice(0, -3) : s,
          hasEllipsis,
        };
      }),
    [rawSteps],
  );

  type Stage = "idle" | "typing" | "dots" | "done";
  type LineState = { stage: Stage; typedLen: number; dotCount: number };

  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [lineStates, setLineStates] = useState<LineState[]>(() =>
    lineInfo.map((info) => ({
      stage: "idle",
      typedLen: 0,
      dotCount: info.hasEllipsis ? 1 : 0,
    })),
  );

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // Typing speed for "character by character" console animation.
  // Mantiene el "slow, alive typing" que pediste para que el texto se sienta real.
  const CHAR_MS = 85;
  const DOT_MS = 350;

  useEffect(() => {
    let cancelled = false;

    // Reset terminal state when the computed text changes (e.g. url changes).
    setActiveIndex(-1);
    setLineStates(
      lineInfo.map((info) => ({
        stage: "idle",
        typedLen: 0,
        dotCount: info.hasEllipsis ? 1 : 0,
      })),
    );

    if (phase < 0) {
      return () => {
        cancelled = true;
      };
    }

    async function runSequence() {
      const pauseBetweenLinesMs = 220;
      const lastIndex = lineInfo.length - 1;

      for (let i = 0; i < lineInfo.length; i++) {
        if (cancelled) return;

        setActiveIndex(i);
        setLineStates((prev) =>
          prev.map((s, idx) => {
            if (idx < i) {
              const prevInfo = lineInfo[idx];
              return {
                stage: "done",
                typedLen: prevInfo.base.length,
                dotCount: prevInfo.hasEllipsis ? 3 : 0,
              };
            }
            if (idx > i) {
              return {
                stage: "idle",
                typedLen: 0,
                dotCount: lineInfo[idx].hasEllipsis ? 1 : 0,
              };
            }

            return {
              stage: "typing",
              typedLen: 0,
              dotCount: lineInfo[idx].hasEllipsis ? 1 : 0,
            };
          }),
        );

        const info = lineInfo[i];

        // Type base chars.
        for (let len = 1; len <= info.base.length; len++) {
          if (cancelled) return;
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], stage: "typing", typedLen: len };
            return next;
          });
          await sleep(CHAR_MS);
        }

        if (!info.hasEllipsis) {
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], stage: "done", typedLen: info.base.length, dotCount: 0 };
            return next;
          });
          await sleep(pauseBetweenLinesMs);
          continue;
        }

        // Base finished: keep loading "..." after each line.
        // - Intermedias: 2s loop (1 -> 2 -> 3 -> 1 ...)
        // - Última: loop indefinido hasta desmontar
        if (i === lastIndex) {
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = {
              ...next[i],
              stage: "dots",
              typedLen: info.base.length,
              dotCount: 1,
            };
            return next;
          });

          while (!cancelled) {
            setLineStates((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], stage: "dots", dotCount: 1 };
              return next;
            });
            await sleep(DOT_MS);
            if (cancelled) return;

            setLineStates((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], stage: "dots", dotCount: 2 };
              return next;
            });
            await sleep(DOT_MS);
            if (cancelled) return;

            setLineStates((prev) => {
              const next = [...prev];
              next[i] = { ...next[i], stage: "dots", dotCount: 3 };
              return next;
            });
            await sleep(DOT_MS);
            if (cancelled) return;
          }
          return;
        }

        // Intermedia: loop fijo 2s
        const loopUntil = Date.now() + 2000;
        setLineStates((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], stage: "dots", typedLen: info.base.length, dotCount: 1 };
          return next;
        });

        while (!cancelled && Date.now() < loopUntil) {
          setLineStates((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], stage: "dots", dotCount: 1 };
            return next;
          });
          await sleep(DOT_MS);
          if (cancelled) return;
          if (Date.now() >= loopUntil) break;

          setLineStates((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], stage: "dots", dotCount: 2 };
            return next;
          });
          await sleep(DOT_MS);
          if (cancelled) return;
          if (Date.now() >= loopUntil) break;

          setLineStates((prev) => {
            const next = [...prev];
            next[i] = { ...next[i], stage: "dots", dotCount: 3 };
            return next;
          });
          await sleep(DOT_MS);
          if (cancelled) return;
        }

        // Cierra intermedia dejando "...".
        setLineStates((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], stage: "done", typedLen: info.base.length, dotCount: 3 };
          return next;
        });

        await sleep(pauseBetweenLinesMs);
      }
    }

    void runSequence();

    return () => {
      cancelled = true;
    };
  }, [lineInfo]);

  const getLineText = (i: number) => {
    const info = lineInfo[i];
    const st = lineStates[i];

    if (i < activeIndex) {
      return info.hasEllipsis ? `${info.base}...` : info.base;
    }
    if (i > activeIndex) return "";

    if (st.stage === "typing") {
      return info.base.slice(0, st.typedLen);
    }
    if (st.stage === "dots") {
      return `${info.base}${".".repeat(st.dotCount)}`;
    }
    // done
    return info.hasEllipsis ? `${info.base}...` : info.base;
  };

  return (
    <GlassCard
      glass
      glow="none"
      noPad
      className="mb-6 !rounded-2xl border border-white/[0.12]"
    >
      <div className="p-3 sm:p-4">
        {/* Terminal header (estética de consola) */}
        <div className="mb-3 flex items-center justify-between border-b border-white/[0.08] pb-2">
          <div className="flex items-center gap-2" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full border border-pv-danger/25 bg-pv-danger/[0.08]" />
            <span className="h-2.5 w-2.5 rounded-full border border-pv-gold/25 bg-pv-gold/[0.08]" />
            <span className="h-2.5 w-2.5 rounded-full border border-pv-emerald/25 bg-pv-emerald/[0.08]" />
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-pv-muted">
            resolve console
          </span>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/[0.18] p-3 sm:p-4">
          <div className="font-mono text-sm text-pv-muted text-left leading-[2.2]">
            {lineInfo.map((_, i) => {
              if (i > activeIndex) return null;
              const isActive = i === activeIndex;

              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0.2, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={
                    isActive
                      ? "text-pv-emerald"
                      : "text-pv-emerald/60"
                  }
                >
                  <span className={isActive ? "text-pv-emerald/80 mr-1" : "text-pv-emerald/35 mr-1"}>
                    &gt;
                  </span>{" "}
                  {getLineText(i)}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
