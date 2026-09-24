"use client";

import { useEffect, useState } from "react";
import { applyMode, MODE_STORAGE_KEY } from "@digitaplatform/theme";

/**
 * Light/dark toggle. Pins the mode under the app's key (one origin, one setting for website and
 * app) and applies it through the theme runtime. The pre-paint script in layout.tsx sets the
 * initial class; this only handles user toggles.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = dark ? "light" : "dark";
    setDark(next === "dark");
    applyMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* ignore storage failures (private mode) */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-textMuted transition-colors hover:bg-bgHover hover:text-textMain"
    >
      <span aria-hidden className="text-base leading-none">
        {dark ? "☀" : "☾"}
      </span>
    </button>
  );
}
