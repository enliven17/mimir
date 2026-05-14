"use client";

import { useLayoutEffect } from "react";

function shouldForceTop() {
  if (typeof window === "undefined") return false;

  // Detect full reload vs client navigation (professional & less intrusive).
  try {
    const navEntries = performance.getEntriesByType(
      "navigation"
    ) as PerformanceNavigationTiming[];
    const nav = navEntries[0];

    // Common values: "navigate", "reload", "back_forward", "prerender"
    return nav?.type === "reload" || nav?.type === "navigate";
  } catch {
    // Fallback: force on mount when we can't detect type.
    return true;
  }
}

export default function ScrollToTopOnLoad() {
  useLayoutEffect(() => {
    if (!shouldForceTop()) return;

    // Prevent browser scroll restoration from fighting us.
    const prevRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    // Restore default behavior after the scroll settles.
    requestAnimationFrame(() => {
      window.history.scrollRestoration = prevRestoration;
    });
  }, []);

  return null;
}

