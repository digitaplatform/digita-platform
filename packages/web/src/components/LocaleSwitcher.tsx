"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSiteConfig } from "@/config/ConfigProvider";
import { isLocale, LOCALE_COOKIE } from "@/config/locales";
import type { Locale } from "@/i18n/config";

/** Human label for a locale code; falls back to the uppercased code for any
 *  locale not in the map (the renderer stays generic for unknown languages). */
const LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  fr: "Français",
  es: "Español",
  tr: "Türkçe",
};
const labelFor = (loc: string) => LABELS[loc] ?? loc.toUpperCase();

/**
 * Language switcher — a custom dropdown (not a native <select>, whose open-list
 * selection is unstyleable and barely visible in dark mode). The current language
 * shows on the button; in the open list the active one is marked with an accent +
 * check. Offers the site's enabled locales, else all runtime-configured ones.
 */
export function LocaleSwitcher({ current, enabled, label }: { current: Locale; enabled: Locale[]; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locales } = useSiteConfig();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = enabled.length ? enabled : locales;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: string) {
    setOpen(false);
    if (!isLocale(next, locales) || next === current) return;
    // Remember the manual choice so the middleware keeps it on a later visit to a
    // locale-less URL (1 year, lax). Generic — just the language code.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const segments = pathname.split("/");
    if (segments[1] && isLocale(segments[1], locales)) segments[1] = next;
    else segments.splice(1, 0, next);
    startTransition(() => router.push(segments.join("/") || `/${next}`));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-fg transition-colors hover:bg-hover focus-visible:border-line-strong"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
        </svg>
        <span>{labelFor(current)}</span>
        <svg aria-hidden viewBox="0 0 24 24" className={`h-3.5 w-3.5 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute right-0 z-50 mt-2 min-w-[11rem] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg"
        >
          {options.map((loc) => {
            const active = loc === current;
            return (
              <li key={loc} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => pick(loc)}
                  className={`flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm transition-colors ${
                    active ? "bg-primary-soft font-medium text-primary" : "text-fg hover:bg-hover"
                  }`}
                >
                  <span>{labelFor(loc)}</span>
                  {active && (
                    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
