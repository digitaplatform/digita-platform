"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

// useLayoutEffect on the client (re-applies BEFORE paint → no flash), useEffect
// on the server render (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Keeps the `.dark` class on <html> across client navigations. The root layout
 * re-renders `<html className={theme.htmlClass}>` on every (cross-locale)
 * navigation, which overwrites the class the pre-hydration script set — so the
 * theme would snap back to light after a language switch. Re-asserting it on each
 * pathname change (before paint) holds the chosen mode without a flash.
 */
export function ThemeKeeper() {
  const pathname = usePathname();
  useIsoLayoutEffect(() => {
    try {
      const m = localStorage.getItem("digita-web-mode");
      const dark = m ? m === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      /* ignore (private mode / no matchMedia) */
    }
  }, [pathname]);
  return null;
}
