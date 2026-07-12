/**
 * Locale-aware number/currency formatting via the platform's locale codes
 * (en/de/it/fr/es/tr are valid BCP-47 tags). Use for UI display — NOT for raw
 * API/JSON values, which stay locale-agnostic (always a point decimal).
 * e.g. formatCurrency(1886.15, "de") → "1.886,15 €"; ("en") → "€1,886.15".
 */
export function formatCurrency(value: number, locale: string, currency = "EUR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}

export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
