"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { useWallet } from "@/lib/wallet";
import { shortenAddress } from "@/lib/constants";
import { getExplorerAddressUrl } from "@/lib/arc";
import { Copy, ExternalLink, LogOut, Menu, X } from "lucide-react";
import { isXmtpFeatureEnabled } from "@/lib/xmtp/config";

function WalletAccountMenu({
  address,
  open,
  onOpenChange,
  onDisconnect,
  containerRef,
  buttonClassName,
}: {
  address: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onDisconnect: () => void;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  buttonClassName: string;
}) {
  const t = useTranslations("header");
  const [copied, setCopied] = useState(false);
  const explorerHref = getExplorerAddressUrl(address);

  const actionItemClass =
    "group flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-left text-[13px] font-medium text-pv-text/82 transition-[background-color,border-color,color,transform] hover:border-pv-emerald/20 hover:bg-pv-emerald/[0.07] hover:text-pv-text";
  const iconClass =
    "h-4 w-4 shrink-0 text-pv-muted transition-colors group-hover:text-pv-emerald";

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("walletMenu")}
        className={buttonClassName}
      >
        {shortenAddress(address)}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-[calc(100%+4px)] z-[60] min-w-[240px] overflow-hidden rounded-2xl border border-white/[0.14] bg-[linear-gradient(180deg,rgba(36,35,35,0.96),rgba(24,24,24,0.98))] p-2 shadow-[0_22px_60px_-20px_rgba(0,0,0,0.75)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-white/12 before:to-transparent"
          >
            <div className="mb-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
              <p className="font-display text-[13px] font-bold tracking-tight text-pv-text">
                {shortenAddress(address)}
              </p>
              <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted">
                {t("connectedWallet")}
              </p>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={handleCopyAddress}
              className={actionItemClass}
            >
              <Copy className={iconClass} aria-hidden />
              <span>{copied ? t("copiedAddress") : t("copyAddress")}</span>
            </button>
            <a
              href={explorerHref}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={() => onOpenChange(false)}
              className={`${actionItemClass} mt-1`}
            >
              <ExternalLink className={iconClass} aria-hidden />
              <span>{t("viewOnExplorer")}</span>
            </a>
            <div className="my-2 h-px bg-white/[0.08]" aria-hidden />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDisconnect();
                onOpenChange(false);
              }}
              className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-left text-[13px] font-medium text-pv-muted transition-[background-color,border-color,color] hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-pv-text"
            >
              <LogOut
                className="h-4 w-4 shrink-0 text-pv-muted transition-colors group-hover:text-pv-text"
                aria-hidden
              />
              <span>{t("disconnect")}</span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function Header() {
  const { address, isConnected, isConnecting, connect, disconnect } = useWallet();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuDesktopRef = useRef<HTMLDivElement>(null);
  const walletMenuMobileRef = useRef<HTMLDivElement>(null);

  const t = useTranslations("header");
  const tc = useTranslations("common");

  const isPresentationHome = pathname === "/";
  const xmtpNavEnabled = useMemo(() => isXmtpFeatureEnabled(), []);

  const NAV_ITEMS = useMemo(() => {
    const items: Array<{
      href: "/vs/create" | "/explorer" | "/dashboard" | "/messages" | "/stats" | "/bridge";
      label: string;
      accent: boolean;
      mobileLabel?: string;
    }> = [
      { href: "/vs/create", label: t("challenge"), accent: true },
      { href: "/explorer", label: t("explore"), accent: false },
      { href: "/dashboard", label: t("myVS"), accent: false },
      { href: "/bridge", label: "Bridge", accent: false },
      { href: "/stats", label: "Stats", accent: false },
    ];
    if (xmtpNavEnabled) {
      items.push({
        href: "/messages",
        label: t("messages"),
        accent: false,
        mobileLabel: t("messagesMobile"),
      });
    }
    return items;
  }, [t, xmtpNavEnabled]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        walletMenuDesktopRef.current?.contains(el) ||
        walletMenuMobileRef.current?.contains(el)
      ) {
        return;
      }
      setWalletMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [walletMenuOpen]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [walletMenuOpen]);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.08] bg-pv-surface/75 pt-[env(safe-area-inset-top)] backdrop-blur-[20px]">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="group font-display text-lg font-bold tracking-tight text-pv-emerald transition-colors duration-300 ease-in-out sm:text-xl">
            Mimir
            <span
              className="ml-[1px] inline-block origin-center leading-none text-pv-text transition-[color,transform] duration-300 ease-out will-change-transform group-hover:scale-[1.22] group-hover:-rotate-6 group-hover:text-pv-emerald"
              aria-hidden
            >
              .
            </span>
          </span>
        </Link>

        {isPresentationHome ? (
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href="/explorer"
              className="btn-compact-primary px-4 py-1.5 text-[12px] focus-ring sm:text-[13px]"
            >
              {t("launchApp")}
            </Link>
          </div>
        ) : (
          <>
            {/* Desktop nav */}
            <div className="hidden items-center gap-2 md:flex lg:gap-3">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`chip relative text-[13px] transition-all ${
                      item.accent
                        ? "border-pv-emerald/[0.28] bg-pv-emerald/[0.08] text-pv-emerald"
                        : isActive
                        ? "border-white/[0.32] bg-white/[0.06] text-pv-text"
                        : "text-pv-muted hover:border-white/[0.22] hover:text-pv-text"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}

              {isConnected && address ? (
                <WalletAccountMenu
                  address={address}
                  open={walletMenuOpen}
                  onOpenChange={setWalletMenuOpen}
                  onDisconnect={disconnect}
                  containerRef={walletMenuDesktopRef}
                  buttonClassName="chip font-mono text-[11px] text-pv-emerald border-pv-emerald/[0.25] focus-ring"
                />
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={isConnecting}
                  className="btn-compact-primary px-4 py-1.5 text-[13px] focus-ring"
                >
                  {isConnecting ? "..." : tc("connect")}
                </button>
              )}
            </div>

            {/* Mobile */}
            <div className="flex items-center gap-2 md:hidden">
              {isConnected && address ? (
                <WalletAccountMenu
                  address={address}
                  open={walletMenuOpen}
                  onOpenChange={setWalletMenuOpen}
                  onDisconnect={disconnect}
                  containerRef={walletMenuMobileRef}
                  buttonClassName="chip font-mono text-[10px] text-pv-emerald border-pv-emerald/[0.25]"
                />
              ) : (
                <button
                  type="button"
                  onClick={connect}
                  disabled={isConnecting}
                  className="btn-compact-primary px-3 py-1.5 text-[12px]"
                >
                  {isConnecting ? "..." : tc("connect")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileOpen(!mobileOpen)}
                className="rounded p-1.5 text-pv-muted transition-colors hover:text-pv-text"
                aria-expanded={mobileOpen}
                aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Mobile sheet */}
      <AnimatePresence>
        {!isPresentationHome && mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/[0.08] md:hidden"
          >
            <LayoutGroup id="mobile-header-nav">
              <nav
                className="flex flex-col gap-0.5 px-5 py-3"
                aria-label={t("mobileNavAria")}
              >
                {NAV_ITEMS.map((item) => {
                  const isActive = pathname === item.href;
                  const label = item.accent
                    ? t("challengeMobile")
                    : item.mobileLabel ?? item.label;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={`relative block overflow-hidden rounded-lg px-4 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg ${
                        isActive
                          ? "text-pv-text"
                          : "text-pv-muted hover:text-pv-text"
                      }`}
                    >
                      {isActive ? (
                        <motion.span
                          layoutId="mobile-nav-active-highlight"
                          className="absolute inset-0 rounded-lg border border-pv-emerald/[0.28] bg-pv-emerald/[0.1]"
                          transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          initial={false}
                        />
                      ) : null}
                      <span className="relative z-10">{label}</span>
                    </Link>
                  );
                })}
              </nav>
            </LayoutGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
