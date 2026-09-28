import { SUPPORTED_LANGUAGES } from "@digitaplatform/shared";

/**
 * Locale config — read from env at call time (NO hardcoded list, NO fallback).
 * Edge-safe (no "server-only") so the middleware can import it too. Throws with a
 * clear message if LOCALES / DEFAULT_LOCALE are missing or inconsistent, or if
 * LOCALES names a language the site's texts do not carry.
 */
function req(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`[digita-web] missing required env var: ${key}`);
  return v;
}

export function getLocales(): string[] {
  const list = req("LOCALES")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) throw new Error("[digita-web] LOCALES must be a non-empty comma-separated list");
  const unsupported = list.filter((locale) => !(SUPPORTED_LANGUAGES as readonly string[]).includes(locale));
  if (unsupported.length) {
    throw new Error(
      `[digita-web] LOCALES names ${unsupported.join(",")}, which the site's texts do not carry (${SUPPORTED_LANGUAGES.join(",")})`,
    );
  }
  return list;
}

export function getDefaultLocale(): string {
  const d = req("DEFAULT_LOCALE");
  const locales = getLocales();
  if (!locales.includes(d)) {
    throw new Error(`[digita-web] DEFAULT_LOCALE "${d}" is not in LOCALES (${locales.join(",")})`);
  }
  return d;
}

export function isLocale(value: string, locales: string[]): boolean {
  return locales.includes(value);
}

/** The locales the language menu offers on one page: the current locale, and every served locale
 *  in which the page's slug is published, narrowed by the site's own enabled list where it is
 *  set. A switch keeps the slug (switchLocalePath), so any other locale would land on a page that
 *  does not exist; slug equality, not the translation group, is therefore the rule here, and a
 *  sibling published under another slug is reachable through hreflang only. */
export function offeredLocales(
  served: readonly string[],
  publishedSlugs: Record<string, readonly string[]>,
  enabled: readonly string[],
  slug: string,
  current: string,
): string[] {
  return served.filter(
    (locale) =>
      (locale === current || (publishedSlugs[locale] ?? []).includes(slug)) &&
      (enabled.length === 0 || enabled.includes(locale) || locale === current),
  );
}

/** The locale a bare URL redirects to for a visitor's Accept-Language, or null. The languages are
 *  read by quality, a region (de-CH) counts as its language, "*" names no locale. The first
 *  language the site offers decides: the default locale gives null, because the bare URL already
 *  shows it, and so does a list that names no offered locale. */
export function preferredLocale(acceptLanguage: string, offered: readonly string[], defaultLocale: string): string | null {
  const ranked = acceptLanguage
    .split(",")
    .map((entry) => {
      const [tag = "", ...params] = entry.trim().split(";");
      // RFC 9110: a parameter name is case-insensitive, so Q=0.1 is the same quality.
      const quality = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));
      return { language: tag.split("-")[0]!.toLowerCase(), q: quality ? Number(quality.slice(2)) : 1 };
    })
    .filter((e) => e.language && e.language !== "*" && e.q > 0)
    .sort((a, b) => b.q - a.q);
  const first = ranked.find((e) => offered.includes(e.language));
  return first && first.language !== defaultLocale ? first.language : null;
}
