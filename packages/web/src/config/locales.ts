/**
 * Locale config — read from env at call time (NO hardcoded list, NO fallback).
 * Edge-safe (no "server-only") so the middleware can import it too. Throws with a
 * clear message if LOCALES / DEFAULT_LOCALE are missing or inconsistent.
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

/** Cookie remembering a visitor's MANUAL language choice. The middleware prefers
 *  it over Accept-Language so the override survives a return to a locale-less URL
 *  (the LocaleSwitcher writes it). Generic — no content/site coupling. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
