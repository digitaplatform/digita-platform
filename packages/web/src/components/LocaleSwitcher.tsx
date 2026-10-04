"use client";

import { usePathname, useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { LanguageMenu } from "@digitaplatform/components";
import { useSiteConfig } from "@/config/ConfigProvider";
import { isLocale, offeredLocales } from "@/config/locales";
import { pathSlug, switchLocalePath } from "@/lib/nav";
import type { Locale } from "@/i18n/config";

/** Human label for a locale code; falls back to the uppercased code for any
 *  locale not in the map (the renderer stays generic for unknown languages). */
const LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  it: "Italiano",
  fr: "Français",
  es: "Español",
  "es-MX": "Español (México)",
  tr: "Türkçe",
};
const labelFor = (loc: string) => LABELS[loc] ?? loc.toUpperCase();

/**
 * The language picker, the app's own (the kit's LanguageMenu): a globe menu with the active
 * code. Offers what offeredLocales allows for this page; choosing one keeps the page and moves to
 * its URL in that locale, and remembers the pick in the locale cookie for a year, so a bare URL
 * opened later shows this locale and not the browser's. With nothing to switch to, there is no menu.
 */
export function LocaleSwitcher({
  current,
  publishedSlugs,
  enabledLocales,
  label,
}: {
  current: Locale;
  publishedSlugs: Record<string, string[]>;
  enabledLocales: string[];
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { locales, defaultLocale } = useSiteConfig();
  const options = offeredLocales(locales, publishedSlugs, enabledLocales, pathSlug(pathname, locales), current);
  if (options.length < 2) return null;

  function pick(next: string) {
    if (!isLocale(next, locales) || next === current) return;
    document.cookie = `locale=${next}; max-age=31536000; path=/; samesite=lax`;
    router.push(switchLocalePath(pathname, next, locales, defaultLocale));
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
