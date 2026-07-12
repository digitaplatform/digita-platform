/**
 * Lightweight, dependency-free i18n for the digita suite. The MECHANISM lives
 * here in @digita/shared so every service (digita-auth, future digita-post,
 * frontends) shares one translator; each service supplies its OWN locale data.
 *
 * (digita-engine keeps its richer DB-backed translation service for
 * admin-editable, per-document translations — this is for static service
 * messages / error codes.)
 */

/** One locale's key → message-template map (templates use `{param}` placeholders). */
export type LocaleMessages = Record<string, string>;

/** A bundle keyed by language code, e.g. `{ en: {...}, de: {...} }`. */
export type LocaleBundle = Record<string, LocaleMessages>;

export interface Translator {
  /** Resolve `key` in `locale` (→ fallback → key itself), interpolating `{param}`s. */
  t(key: string, params?: Record<string, string | number>, locale?: string): string;
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
        const lang = tag?.trim().split("-")[0]?.toLowerCase();
        let q = 1;
        for (const p of params) {
          const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
          if (m?.[1] !== undefined) q = Number(m[1]);
        }
        return lang ? { lang, q } : null;
      })
      .filter((x): x is { lang: string; q: number } => x !== null && x.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const { lang } of langs) if (supported.includes(lang)) return lang;
    return fallback;
  }

  function t(key: string, params?: Record<string, string | number>, locale?: string): string {
    const loc = locale && supported.includes(locale) ? locale : fallback;
    const template = bundle[loc]?.[key] ?? bundle[fallback]?.[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_m, k: string) =>
      params[k] !== undefined ? String(params[k]) : `{${k}}`,
    );
  }

  return { t, resolveLocale, supported, fallback };
}
