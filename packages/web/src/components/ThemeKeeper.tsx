"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { applyDesign, applyMode, resolveInitialDesign, resolveInitialMode } from "@digitaplatform/theme";

// useLayoutEffect on the client (re-applies BEFORE paint → no flash), useEffect
// on the server render (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Applies the browser's own theme choices the app stored (one origin, the same keys): the mode,
 * which in `system` keeps following the OS, and the design with its tint. The server cannot know
 * either. Re-asserted on each pathname change, so a navigation never drops them.
 */
export function ThemeKeeper() {
  const pathname = usePathname();
  useIsoLayoutEffect(() => {
    applyMode(resolveInitialMode());
    applyDesign(resolveInitialDesign());
  }, [pathname]);
  return null;
}
