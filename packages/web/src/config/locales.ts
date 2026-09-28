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
