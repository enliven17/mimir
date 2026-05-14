"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEFAULT_DASHBOARD_FILTER_URL_STATE,
  parseDashboardUrlSearchParams,
  serializeDashboardUrlState,
  type DashboardFilterUrlState,
  type DashboardUrlTab,
} from "@/lib/dashboardUrlState";

/**
 * Filtros del dashboard en cliente + URL vía `history.replaceState` (mismo criterio que Explore:
 * sin `router.replace` para evitar re-fetch de RSC).
 *
 * - Navegación con URL completa / atrás-adelante: `useSearchParams` o `popstate` alinean estado.
 */
export function useDashboardFilterUrlState() {
  const searchParams = useSearchParams();
  const querySignature = searchParams.toString();

  const [state, setState] = useState<DashboardFilterUrlState>(() =>
    parseDashboardUrlSearchParams(new URLSearchParams(querySignature))
  );

  useEffect(() => {
    setState(parseDashboardUrlSearchParams(new URLSearchParams(querySignature)));
  }, [querySignature]);

  const commitUrl = useCallback((next: DashboardFilterUrlState) => {
    if (typeof window === "undefined") return;
    const qs = serializeDashboardUrlState(next);
    const search = qs ? `?${qs}` : "";
    const url = `${window.location.pathname}${search}`;
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const setTab = useCallback(
    (tab: DashboardUrlTab) => {
      setState((prev) => {
        const next = { ...prev, tab };
        commitUrl(next);
        return next;
      });
    },
    [commitUrl]
  );

  const setSearchQuery = useCallback(
    (search: string) => {
      setState((prev) => {
        const next = { ...prev, search };
        commitUrl(next);
        return next;
      });
    },
    [commitUrl]
  );

  const setCategoryFilter = useCallback(
    (cat: string) => {
      setState((prev) => {
        const next = { ...prev, cat };
        commitUrl(next);
        return next;
      });
    },
    [commitUrl]
  );

  const setMinStakeFilter = useCallback(
    (minStake: number) => {
      setState((prev) => {
        const next = { ...prev, minStake };
        commitUrl(next);
        return next;
      });
    },
    [commitUrl]
  );

  const resetFilters = useCallback(() => {
    setState(DEFAULT_DASHBOARD_FILTER_URL_STATE);
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
      setState(
        parseDashboardUrlSearchParams(new URLSearchParams(window.location.search))
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return {
    tab: state.tab,
    setTab,
    searchQuery: state.search,
    setSearchQuery,
    categoryFilter: state.cat,
    setCategoryFilter,
    minStakeFilter: state.minStake,
    setMinStakeFilter,
    resetFilters,
  };
}
