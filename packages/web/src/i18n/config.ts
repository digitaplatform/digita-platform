/**
 * Locales are runtime config now (see src/config/locales.ts), not a hardcoded
 * compile-time list — so the same generic renderer serves any site's languages.
 * `Locale` is therefore a plain string; validate against the runtime list with
 * `isLocale(value, locales)` from src/config/locales.
 */
export type Locale = string;
