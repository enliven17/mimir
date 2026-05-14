"use client";

import { useCallback, useLayoutEffect } from "react";

export default function SkipToContentLink() {
  useLayoutEffect(() => {
    // Si el usuario recarga con hash, el navegador puede auto-scrollear al elemento.
    // Lo limpiamos en layout effect para evitar el salto (y la sensación de navbar "cortado").
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#main-content") return;

    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const handleSkip = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();

      const main = document.getElementById("main-content");
      if (!main) return;

      const header = document.querySelector("header");
      const headerHeight =
        header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;

      const top = main.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      (main as HTMLElement).focus({ preventScroll: true });

      // Limpieza de hash para evitar auto-scroll en recargas futuras.
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", cleanUrl);
    },
    []
  );

  return (
    <a
      href="#main-content"
      onClick={handleSkip}
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-pv-emerald focus:text-pv-bg focus:rounded-lg focus:font-bold"
    >
      Skip
    </a>
  );
}

