import { describe, it, expect } from 'vitest';
import {
  parseUrlFilter,
  objectFilterToTuples,
  mergeFilters,
  normalizeListParams,
  type FilterTuple,
} from '@/lib/filter-from-url';

describe('parseUrlFilter', () => {
  it('decodes a JSON object', () => {
    expect(parseUrlFilter(JSON.stringify({ is_active: true }))).toEqual({ is_active: true });
  });
  it('absent → {}', () => {
    expect(parseUrlFilter(null)).toEqual({});
    expect(parseUrlFilter('')).toEqual({});
  });
  it('a JSON array is not an object → {}', () => {
    expect(parseUrlFilter(JSON.stringify([1, 2]))).toEqual({});
  });
  it('malformed JSON → {}', () => {
    expect(parseUrlFilter('{not json')).toEqual({});
  });
});

describe('objectFilterToTuples', () => {
  it('scalar → "="', () => {
    expect(objectFilterToTuples({ status: 'open', qty: 5, flag: true })).toEqual([
      ['status', '=', 'open'],
      ['qty', '=', 5],
      ['flag', '=', true],
    ]);
  });
  it('null → "=" null', () => {
    expect(objectFilterToTuples({ parent: null })).toEqual([['parent', '=', null]]);
  });
  it('array → "in"', () => {
    expect(objectFilterToTuples({ kind: ['a', 'b'] })).toEqual([['kind', 'in', ['a', 'b']]]);
  });
  it('empty array → skipped', () => {
    expect(objectFilterToTuples({ kind: [] })).toEqual([]);
  });
  it('operator-object → skipped (not in the nav contract)', () => {
    expect(objectFilterToTuples({ total: { '>=': 100 } })).toEqual([]);
  });
  it('undefined → skipped', () => {
    expect(objectFilterToTuples({ a: undefined })).toEqual([]);
  });
});

describe('mergeFilters', () => {
  // Phase-3: relaxed to N-per-field (keyed by field|op|value). The nav-vs-bar
  // override moved to effectiveFilters (see filter-codec.test.ts).
  it('keeps multiple distinct tuples on the same field; dedups identical', () => {
    const nav: FilterTuple[] = [['status', '=', 'open']];
    const ui: FilterTuple[] = [['status', '=', 'closed'], ['kind', '=', 'x'], ['status', '=', 'open']];
    expect(mergeFilters(nav, ui)).toEqual([
      ['status', '=', 'open'],
      ['status', '=', 'closed'],
      ['kind', '=', 'x'],
    ]);
  });
});

describe('normalizeListParams', () => {
  it('sorts filters + drops empties', () => {
    const out = normalizeListParams({
      page: 1,
      page_size: 0,
      search: '',
      filters: [['b', '=', 1], ['a', '=', 2]],
    });
    expect(out).toEqual({ page: 1, filters: [['a', '=', 2], ['b', '=', 1]] });
  });
});
