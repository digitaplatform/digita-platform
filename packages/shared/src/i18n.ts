/**
 * Lightweight, dependency-free i18n for the digita suite: one synchronous translator over a bundle
 * of every language's messages. The messages of a build are the folder named after it in the public
 * repository digitaplatform/digita-translations (`translations/<build>/<language>.json`); a pod gets
 * its stage's pinned commit of that folder as files. Load them with `fetchBundle` in a browser or
 * `readBundle` (`@digitaplatform/shared/i18n-node`) in Node.
 *
 * (digita-engine keeps its DB-backed translation service for the apps' texts, which tenants edit —
 * this is for the built-in texts of the platform and its services.)
 */

/** One locale's key → message-template map (templates use `{param}` placeholders). */
export type LocaleMessages = Record<string, string>;

/** A bundle keyed by language code, e.g. `{ en: {...}, de: {...} }`. */
export type LocaleBundle = Record<string, LocaleMessages>;

/** The languages every build's translations carry in full. */
export const SUPPORTED_LANGUAGES = ["en", "de", "es", "es-MX", "fr", "it", "tr"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** The language a text falls back to when the asked one lacks it. */
export const FALLBACK_LANGUAGE: Language = "en";

export interface Translator {
  /** Resolve `key` in `locale` (→ base language → fallback → key itself), interpolating `{param}`s. */
  t(key: string, params?: Record<string, string | number>, locale?: string): string;
  /**
   * The `<key>.one` or `<key>.other` message for `count`, as the language's plural rules pick it,
   * with `{count}` filled.
   */
  tPlural(key: string, count: number, params?: Record<string, string | number>, locale?: string): string;
  /** Pick the best supported language from an Accept-Language header. */
  resolveLocale(acceptLanguage?: string | null): string;
  readonly supported: string[];
  readonly fallback: string;
}

export function createTranslator(bundle: LocaleBundle, fallback: string): Translator {
  const supported = Object.keys(bundle);

  function resolveLocale(acceptLanguage?: string | null): string {
    if (!acceptLanguage) return fallback;
    // Honor the RFC 9110 §12.5.4 quality weights, e.g. "en;q=0.8,de;q=0.9" must
    // prefer `de` even though `en` is written first. Parse `;q=`, drop q=0 (not
    // acceptable), and sort by weight — Array.sort is stable, so equal weights keep
    // their written order.
    const langs = acceptLanguage
      .split(",")
      .map((part) => {
        const [tag, ...params] = part.trim().split(";");
        const lang = tag?.trim().toLowerCase();
        let q = 1;
        for (const p of params) {
          const m = /^\s*q=([0-9.]+)\s*$/i.exec(p);
          if (m?.[1] !== undefined) q = Number(m[1]);
        }
        return lang ? { lang, q } : null;
      })
      .filter((x): x is { lang: string; q: number } => x !== null && x.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const { lang } of langs) {
      const exact = supported.find((code) => code.toLowerCase() === lang);
      if (exact) return exact;
      const base = lang.split("-")[0]!;
      if (supported.includes(base)) return base;
    }
    return fallback;
  }

  function languageOf(locale?: string): string {
    return resolveLocale(locale);
  }

  function t(key: string, params?: Record<string, string | number>, locale?: string): string {
    const loc = languageOf(locale);
    const template = bundle[loc]?.[key] ?? bundle[loc.split("-")[0]!]?.[key] ?? bundle[fallback]?.[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  }

  function tPlural(key: string, count: number, params?: Record<string, string | number>, locale?: string): string {
    const loc = languageOf(locale);
    const form = new Intl.PluralRules(loc).select(count) === "one" ? "one" : "other";
    return t(`${key}.${form}`, { count, ...params }, loc);
  }

  return { t, tPlural, resolveLocale, supported, fallback };
}

/**
 * Loads every supported language of one build's translations in a browser: `<baseUrl><language>.json`,
 * where `baseUrl` ends in "/". A file the server does not deliver fails the load, naming it.
 */
export async function fetchBundle(
  baseUrl: string,
  languages: readonly string[] = SUPPORTED_LANGUAGES,
): Promise<LocaleBundle> {
  const entries = await Promise.all(
    languages.map(async (language) => {
      const url = `${baseUrl}${language}.json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`translations: ${url} answered ${response.status}`);
      return [language, (await response.json()) as LocaleMessages] as const;
    }),
  );
  return Object.fromEntries(entries);
}
