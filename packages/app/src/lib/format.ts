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

/** The wall clock of an instant in a time zone (the runtime's own zone when none). */
function wallClock(instant: Date, timezone: string | null | undefined): Record<string, number> {
  const o: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  };
  if (timezone) o.timeZone = timezone;
  const parts: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', o).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts;
}

/** How far a time zone's wall clock runs ahead of UTC at an instant, in milliseconds. */
function zoneOffset(instant: number, timezone: string | null | undefined): number {
  const w = wallClock(new Date(instant), timezone);
  const wall = Date.UTC(w.year!, w.month! - 1, w.day!, w.hour!, w.minute!, w.second!);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** A stored Datetime as the `YYYY-MM-DDTHH:mm` text of a `datetime-local` input, on the
 *  wall clock of the person's time zone, so the form shows the time `formatDatetime`
 *  shows in the list. A value that is no instant is shown as it is. */
export function toDatetimeInput(value: unknown, timezone: string | null | undefined): string {
  if (isBlank(value)) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const w = wallClock(d, timezone);
  const pad = (n: number | undefined) => String(n).padStart(2, '0');
  return `${String(w.year).padStart(4, '0')}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The UTC instant (ISO with its `Z`) of a `datetime-local` text read on the wall clock
 *  of the person's time zone; undefined for an empty or unreadable text. A wall time a
 *  clock change repeats resolves to its later instant; one it skips moves forward by the
 *  size of the change, as the clock on the wall does. */
export function fromDatetimeInput(text: string, timezone: string | null | undefined): string | undefined {
  const m = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1).map((n) => Number(n ?? 0));
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  const first = wall - zoneOffset(wall, timezone);
  // The offset read at the wall time taken as UTC is hours away from the instant itself,
  // so a clock change between them gives the wrong one: read it again at the first guess.
  return new Date(wall - zoneOffset(first, timezone)).toISOString();
}

/** A wall time `HH:mm` as the list writes the time of a Datetime in the locale (12/24h per locale). */
export function formatWallTime(time: string, locale: string | undefined): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return time;
  return new Intl.DateTimeFormat(loc(locale), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2]))),
  );
}

/** The marks of the morning and the afternoon in a locale, lower case and without dots or spaces. */
function dayPeriods(locale: string | undefined): { am: string[]; pm: string[] } {
  const f = new Intl.DateTimeFormat(loc(locale), { hour: 'numeric', hour12: true, timeZone: 'UTC' });
  const mark = (hour: number) =>
    normalizePeriod(f.formatToParts(new Date(Date.UTC(1970, 0, 1, hour))).find((p) => p.type === 'dayPeriod')?.value ?? '');
  return { am: ['am', mark(1)].filter(Boolean), pm: ['pm', mark(13)].filter(Boolean) };
}

function normalizePeriod(text: string): string {
  return text.toLowerCase().replace(/[.\s]/g, '');
}

/** The `HH:mm` wall time of a time a person typed: hour and minutes apart by a colon or a dot, on a
 *  24-hour clock or with the locale's mark of morning or afternoon; undefined for any other text. */
export function parseWallTime(text: string, locale: string | undefined): string | undefined {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(.*?)\s*$/.exec(text);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const mark = normalizePeriod(m[3] ?? '');
  if (minute > 59) return undefined;
  if (mark) {
    const { am, pm } = dayPeriods(locale);
    if (hour < 1 || hour > 12) return undefined;
    if (am.includes(mark)) hour %= 12;
    else if (pm.includes(mark)) hour = (hour % 12) + 12;
    else return undefined;
  } else if (hour > 23) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}`;
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
