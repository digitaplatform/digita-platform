"use client";

import { useEffect, useState } from "react";

/**
 * Light/dark toggle. Persists to localStorage and flips the `.dark` class on
 * <html> (the @digitaplatform/theme convention). The pre-hydration script in layout.tsx
 * sets the initial class to avoid a flash; this only handles user toggles.
 */
const KEY = "digita-web-mode";

export function ThemeToggle({ label }: { label: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line text-fg-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <span aria-hidden className="text-base leading-none">
        {dark ? "☀" : "☾"}
      </span>
    </button>
  );
}
