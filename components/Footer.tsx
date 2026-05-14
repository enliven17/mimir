"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const FOOTER_LINKS = [
  { href: "#network-protocol", key: "linkNetworkProtocol" as const },
  { href: "#privacy", key: "linkPrivacy" as const },
  { href: "#security", key: "linkSecurity" as const },
  { href: "#api", key: "linkApi" as const },
];

export default function Footer() {
  const t = useTranslations("footer");

  return (
    <footer className="mt-8 sm:mt-12 border-t border-white/[0.08]">
      <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-stretch md:gap-8 lg:gap-12">
          {/* Marca y créditos — alineados al inicio de su columna */}
          <div className="flex flex-col items-center text-center md:items-start md:justify-start md:text-left">
            <span className="group font-display text-lg font-bold tracking-tight text-pv-emerald transition-colors duration-300 ease-in-out sm:text-xl">
              PROVEN
              <span className="text-pv-text transition-colors duration-300 ease-in-out group-hover:text-pv-emerald">
                .
              </span>
            </span>
            <p className="mt-4 max-w-[420px] text-[10px] leading-relaxed tracking-wide text-pv-muted sm:max-w-[480px] sm:text-[11px]">
              {t("creditLine")}
            </p>
          </div>

          {/* Enlaces legales — misma altura que la columna izquierda; contenido centrado en vertical */}
          <nav
            className="flex min-h-0 flex-wrap items-center justify-center gap-x-6 gap-y-3 md:h-full md:content-center md:justify-end md:pl-2 lg:pl-4"
            aria-label={t("legalNavAria")}
          >
            {FOOTER_LINKS.map(({ href, key }) => (
              <Link
                key={key}
                href={href}
                className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted transition-colors hover:text-pv-emerald sm:text-[11px]"
              >
                {t(key)}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
