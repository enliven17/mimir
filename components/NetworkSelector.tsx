"use client";

/**
 * Header network switcher: which chain new claims open on and where the
 * wallet is steered. Renders nothing while only one escrow is deployed.
 *
 * Listbox pattern: the trigger opens a list whose options take focus, so
 * ArrowUp/ArrowDown/Home/End move, Enter/Space pick, Escape/Tab close and
 * return focus to the trigger.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { getChain, type ChainKey } from "@/lib/chains";
import { CHAIN_DOT_CLASS } from "@/lib/chainUi";
import { useWallet } from "@/lib/wallet";

export default function NetworkSelector({ className = "" }: { className?: string }) {
  const t = useTranslations("network");
  const { selectedChain, setSelectedChain, enabledChains, isConnected, isCorrectNetwork } =
    useWallet();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = `${useId().replace(/:/g, "")}-networks`;

  // Outside click closes without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Opening lands focus on the current network.
  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, enabledChains.indexOf(selectedChain));
    optionRefs.current[i]?.focus();
  }, [open, enabledChains, selectedChain]);

  if (enabledChains.length < 2) return null;

  const current = getChain(selectedChain);
  const mismatch = isConnected && !isCorrectNetwork;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const pick = (key: ChainKey) => {
    setSelectedChain(key);
    close();
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = optionRefs.current.findIndex((el) => el === document.activeElement);
    const last = enabledChains.length - 1;
    const focusAt = (n: number) => optionRefs.current[n]?.focus();
    if (e.key === "ArrowDown") focusAt(i >= last ? 0 : i + 1);
    else if (e.key === "ArrowUp") focusAt(i <= 0 ? last : i - 1);
    else if (e.key === "Home") focusAt(0);
    else if (e.key === "End") focusAt(last);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t("selectorLabel")}: ${current.name}${mismatch ? `. ${t("walletMismatch")}` : ""}`}
        className={`chip inline-flex items-center gap-1.5 font-mono text-[11px] focus-ring ${
          mismatch ? "border-pv-gold/40 text-pv-gold" : "text-pv-text/85"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${CHAIN_DOT_CLASS[selectedChain]}`} aria-hidden />
        {current.shortName}
        <ChevronDown className="h-3 w-3 text-pv-muted" aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={listId}
            role="listbox"
            aria-label={t("selectorLabel")}
            onKeyDown={onListKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+4px)] z-[60] min-w-[200px] overflow-hidden rounded-2xl border border-pv-border/40 bg-pv-surface/95 p-1.5 shadow-[0_22px_60px_-20px_rgba(51,79,169,0.22)] backdrop-blur-xl"
          >
            {enabledChains.map((key, i) => {
              const cfg = getChain(key);
              const selected = key === selectedChain;
              return (
                <button
                  key={key}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => pick(key)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40 ${
                    selected
                      ? "bg-pv-emerald/[0.12] font-medium text-pv-text"
                      : "text-pv-muted hover:bg-white/[0.05] hover:text-pv-text"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${CHAIN_DOT_CLASS[key]}`} aria-hidden />
                  <span className="flex-1">{cfg.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-pv-muted">
                    {t("gasToken", { symbol: cfg.gasSymbol })}
                  </span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
