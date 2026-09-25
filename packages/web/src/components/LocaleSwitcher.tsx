"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { LanguageMenu } from "@digitaplatform/components";
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
 * The language picker, the app's own (the kit's LanguageMenu): a globe menu with the active
 * code. Offers the site's enabled locales, else all runtime-configured ones; choosing one keeps
 * the page and swaps its locale segment.
 */
export function LocaleSwitcher({ current, enabled, label }: { current: Locale; enabled: Locale[]; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locales } = useSiteConfig();
  const options = enabled.length ? enabled : locales;

  function pick(next: string) {
    if (!isLocale(next, locales) || next === current) return;
    // Remember the manual choice so the middleware keeps it on a later visit to a
    // locale-less URL (1 year, lax). Generic — just the language code.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const segments = pathname.split("/");
    if (segments[1] && isLocale(segments[1], locales)) segments[1] = next;
    else segments.splice(1, 0, next);
    router.push(segments.join("/") || `/${next}`);
  }

  return (
    <LanguageMenu
      label={label}
      current={current}
      icon={<Globe className="h-5 w-5" aria-hidden="true" />}
      languages={options.map((code) => ({ code, label: labelFor(code) }))}
      onSelect={pick}
    />
  );
}
