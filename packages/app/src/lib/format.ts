/**
 * Display formatters driven by the boot locale's BCP-47 `format_locale` (region-
 * aware, e.g. de-CH vs de-DE) + `timezone`, via the Intl API (CLDR) — so number,
 * currency, date and time formatting are correct per region without hand-rolled
 * separator/pattern logic. A missing locale warns once in dev and lets Intl use
 * the runtime default. A null/empty value renders the em-dash, never a fake 0.
 */

import type { FieldDefinition } from '@digitaplatform/shared';

export const EMPTY = '—';

const warned = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (import.meta.env.DEV && !warned.has(key)) {
    warned.add(key);
    console.warn(msg);
  }
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

/** BCP-47 locale for Intl; undefined → runtime default (warns once). */
function loc(locale: string | undefined): string | undefined {
  if (!locale) warnOnce('format_locale', '[format] no format_locale from boot — using runtime default');
  return locale || undefined;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return isNaN(n) ? null : n;
}

/** Locale-formatted number. `precision` fixes the fraction digits if given. */
export function formatNumber(value: unknown, locale: string | undefined, opts?: { precision?: number }): string {
  if (isBlank(value)) return EMPTY;
  const n = toNumber(value);
  if (n === null) return String(value);
  const o: Intl.NumberFormatOptions =
    opts?.precision != null ? { minimumFractionDigits: opts.precision, maximumFractionDigits: opts.precision } : {};
  return new Intl.NumberFormat(loc(locale), o).format(n);
}

/** The fraction digits a money amount shows: the field's own `precision`, else the
 *  minor unit of its currency (2 for CHF, 0 for JPY), else 2, because a bill that
 *  reads 440.9 looks wrong even when nobody named the currency. */
export function currencyFractionDigits(currency: string | null | undefined, precision?: number): number {
  if (precision != null) return precision;
  if (!currency) return 2;
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Locale-formatted currency (symbol + placement per region). Without a currency
 *  the number is rendered plain, still with the two digits of an amount. */
export function formatCurrency(
  value: unknown,
  locale: string | undefined,
  currency: string | null | undefined,
  opts?: { precision?: number },
): string {
  if (isBlank(value)) return EMPTY;
  const n = toNumber(value);
  if (n === null) return String(value);
  if (!currency) {
    warnOnce('currency', '[format] no currency supplied — rendering the number without a symbol');
    return formatNumber(value, locale, { precision: currencyFractionDigits(currency, opts?.precision) });
  }
  const o: Intl.NumberFormatOptions = { style: 'currency', currency };
  if (opts?.precision != null) {
    o.minimumFractionDigits = opts.precision;
    o.maximumFractionDigits = opts.precision;
  }
  return new Intl.NumberFormat(loc(locale), o).format(n);
}

/** Locale-formatted calendar date (numeric). Dates are calendar values → rendered
 *  in UTC so the day never shifts across timezones. */
export function formatDate(value: unknown, locale: string | undefined): string {
  if (isBlank(value)) return EMPTY;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(loc(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(d);
}

/** Locale-formatted datetime in the user's timezone (12/24h per locale). */
export function formatDatetime(value: unknown, locale: string | undefined, timezone?: string | null): string {
  if (isBlank(value)) return EMPTY;
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const o: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (timezone) o.timeZone = timezone;
  return new Intl.DateTimeFormat(loc(locale), o).format(d);
}

/** Percent — the value is already a percentage number (e.g. 42.5 → "42.5 %"),
 *  not a 0–1 ratio, so the number is locale-formatted and a "%" appended. */
export function formatPercent(value: unknown, locale: string | undefined, precision = 2): string {
  if (isBlank(value)) return EMPTY;
  const n = toNumber(value);
  if (n === null) return String(value);
  return `${formatNumber(n, locale, { precision })} %`;
}

/** The keys of a Duration field that hide a unit. */
type DurationUnits = Pick<FieldDefinition, 'hide_days' | 'hide_seconds'>;

/** A Duration, stored as whole seconds, as `[<d>d:]<h>:<mm>[:<ss>]`. `hide_days` folds
 *  the days into the hours and `hide_seconds` drops the seconds. The form control and
 *  the list and grid cells all draw a Duration through here, so they show one text. */
export function formatDuration(seconds: unknown, units?: DurationUnits): string {
  if (isBlank(seconds)) return EMPTY;
  const s = typeof seconds === 'number' ? seconds : Number(seconds);
  if (isNaN(s) || s < 0) return String(seconds);
  const days = units?.hide_days ? 0 : Math.floor(s / 86400);
  const hours = Math.floor(s / 3600) - days * 24;
  const mins = Math.floor((s % 3600) / 60);
  const parts = [`${hours}:${String(mins).padStart(2, '0')}`];
  if (days > 0) parts.unshift(`${days}d`);
  if (!units?.hide_seconds) parts.push(String(Math.floor(s % 60)).padStart(2, '0'));
  return parts.join(':');
}

/** Whole seconds from a text `formatDuration` writes. The last number counts in the
 *  smallest unit the field shows, so a plain `90` is 90 minutes under `hide_seconds`.
 *  Undefined for a text that is no duration. */
export function parseDuration(text: string, units?: DurationUnits): number | undefined {
  const m = /^(?:(\d+)d:?)?(\d+(?::\d+)*)$/.exec(text.replace(/\s+/g, ''));
  if (!m) return undefined;
  const steps = units?.hide_seconds ? [60, 3600] : [1, 60, 3600];
  const numbers = m[2]!.split(':').reverse();
  if (numbers.length > steps.length) return undefined;
  return numbers.reduce((sum, n, i) => sum + Number(n) * steps[i]!, Number(m[1] ?? 0) * 86400);
}

export function formatFileSize(bytes: unknown, locale?: string): string {
  if (isBlank(bytes)) return EMPTY;
  const b = typeof bytes === 'number' ? bytes : Number(bytes);
  if (isNaN(b) || b === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  const n = b / Math.pow(1024, i);
  return `${formatNumber(n, locale, { precision: i > 0 ? 1 : 0 })} ${units[i]}`;
}
