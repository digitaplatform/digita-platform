import type { ListParams } from '@/services/resource';

/**
 * The URL is the ONLY contract between a nav source (the usermenu plugin) and the
 * generic ListPage. The plugin encodes a target as `?filter=<JSON object>`; the
 * engine resource-list API expects `filters=<JSON tuple array>` ([field, op, value]).
 * These pure functions reconcile the two — owned here, imported by ListPage, with
 * no plugin↔page coupling.
 */

export type FilterTuple = [string, string, unknown];

/** Decode `?filter=` (an object). Absent → {}. Malformed / non-object → {} + dev error. */
export function parseUrlFilter(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    if (import.meta.env.DEV) console.error('[filter-from-url] ?filter is not a JSON object:', raw);
    return {};
  } catch {
    if (import.meta.env.DEV) console.error('[filter-from-url] ?filter is not valid JSON:', raw);
    return {};
  }
}

/**
 * Object filter → engine tuples. scalar → "="; null → "=" null; array → "in".
 * An operator-object form ({">=":100}) is NOT in the nav contract and is skipped
 * loudly (a Phase-2 amendment); `[]` is skipped.
 */
export function objectFilterToTuples(obj: Record<string, unknown>): FilterTuple[] {
  const out: FilterTuple[] = [];
  for (const [key, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v === null) {
      out.push([key, '=', null]);
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) {
        if (import.meta.env.DEV) console.warn(`[filter-from-url] empty array for "${key}" — skipped`);
        continue;
      }
      out.push([key, 'in', v]);
      continue;
    }
    if (typeof v === 'object') {
      if (import.meta.env.DEV) {
        console.error(`[filter-from-url] operator-object filter for "${key}" not decoded (Phase 2):`, v);
      }
      continue;
    }
    out.push([key, '=', v]); // scalar string / number / boolean
  }
  return out;
}

/** Full identity key for a tuple — N filters per field coexist (different op/value). */
function tupleKey(t: FilterTuple): string {
  return `${t[0]}|${t[1]}|${JSON.stringify(t[2])}`;
}

/** Union of two tuple lists, deduped by the full (field|op|value) key. N-per-field
 *  allowed; array-value order is significant. */
export function mergeFilters(a: FilterTuple[], b: FilterTuple[]): FilterTuple[] {
  const byKey = new Map<string, FilterTuple>();
  for (const t of [...a, ...b]) byKey.set(tupleKey(t), t);
  return [...byKey.values()];
}

/**
 * The single source of truth for nav-seed-vs-FilterBar override: when the bar is
 * active (the user set `?f`), the bar is AUTHORITATIVE and the nav `?filter` seed is
 * dropped; otherwise the nav seed merges in. Owned here so ListPage has no inline
 * override ternary.
 */
export function effectiveFilters(
  navTuples: FilterTuple[],
  uiTuples: FilterTuple[],
  barActive: boolean,
): FilterTuple[] {
  return barActive ? uiTuples : mergeFilters(navTuples, uiTuples);
}

/** Decode a `?f` / `?of` JSON tuple-array param. Malformed whole-param → [] + dev
 *  error; a single malformed tuple is dropped + dev error (never silently rewritten). */
export function parseFilterTuplesParam(raw: string | null | undefined): FilterTuple[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (import.meta.env.DEV) console.error('[filter-from-url] invalid filter param JSON:', raw);
    return [];
  }
  if (!Array.isArray(parsed)) {
    if (import.meta.env.DEV) console.error('[filter-from-url] filter param is not an array:', raw);
    return [];
  }
  const out: FilterTuple[] = [];
  for (const t of parsed) {
    if (Array.isArray(t) && t.length === 3 && typeof t[0] === 'string' && typeof t[1] === 'string') {
      out.push([t[0], t[1], t[2]]);
    } else if (import.meta.env.DEV) {
      console.error('[filter-from-url] dropping malformed filter tuple:', t);
    }
  }
  return out;
}

export function serializeFilterTuples(tuples: FilterTuple[]): string | undefined {
  return tuples.length ? JSON.stringify(tuples) : undefined;
}

/** `?cols` CSV — order is display order. */
export function parseColumnsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function serializeColumns(cols: string[]): string | undefined {
  return cols.length ? cols.join(',') : undefined;
}

/** Stable param shape (sorted filters/or_filters, projection order preserved, dropped
 *  empties) so the query cache hits across spellings. */
export function normalizeListParams(p: ListParams): ListParams {
  const out: ListParams = {};
  if (p.page) out.page = p.page;
  if (p.page_size) out.page_size = p.page_size;
  if (p.search) out.search = p.search;
  if (p.order_by) out.order_by = p.order_by;
  if (p.fields && p.fields.length) out.fields = p.fields; // projection order is significant
  if (p.filters && p.filters.length) {
    out.filters = [...p.filters].sort((a, b) => tupleKey(a).localeCompare(tupleKey(b)));
  }
  if (p.or_filters && p.or_filters.length) {
    out.or_filters = [...p.or_filters].sort((a, b) => tupleKey(a).localeCompare(tupleKey(b)));
  }
  return out;
}
