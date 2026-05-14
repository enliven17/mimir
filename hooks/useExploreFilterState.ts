"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_EXPLORE_FILTERS,
  parseExploreSearchParams,
  serializeExploreFilters,
  type ExploreFilterState,
} from "@/lib/exploreFilters";

/**
 * Estado de filtros de Explore en cliente + URL sin `router.replace`.
 *
 * `router.replace` con query en App Router provoca navegación soft, re-fetch de RSC
 * y sensación de “recarga” de página. Aquí solo actualizamos la barra de direcciones
 * con `history.replaceState` y React re-renderiza las listas.
 *
 * Sincronización:
 * - Navegación con `<Link>` u otra ruta de Next: `useSearchParams` cambia → alineamos estado.
 * - Atrás/adelante del navegador: `popstate` → leemos `window.location.search`.
 */
export function useExploreFilterState() {
  const searchParams = useSearchParams();
  const querySignature = searchParams.toString();

  const [filters, setFilters] = useState<ExploreFilterState>(() =>
    parseExploreSearchParams(searchParams)
  );

  /**
   * Cuando Next actualiza la URL (Link, navegación inicial, etc.), alineamos estado.
   * Tras `history.replaceState` local, `querySignature` suele NO cambiar → no pisamos el estado.
   */
  useEffect(() => {
    setFilters(
      parseExploreSearchParams(new URLSearchParams(querySignature))
    );
  }, [querySignature]);

  const commitSearchToUrl = useCallback((next: ExploreFilterState) => {
    if (typeof window === "undefined") return;
    const qs = serializeExploreFilters(next);
    const search = qs ? `?${qs}` : "";
    const url = `${window.location.pathname}${search}`;
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const updateFilters = useCallback(
    (patch: Partial<ExploreFilterState>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        commitSearchToUrl(next);
        return next;
      });
    },
    [commitSearchToUrl]
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_EXPLORE_FILTERS);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname
      );
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setFilters(
        parseExploreSearchParams(new URLSearchParams(window.location.search))
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return { filters, updateFilters, resetFilters };
}
