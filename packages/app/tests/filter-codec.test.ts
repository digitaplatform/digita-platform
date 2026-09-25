import { describe, it, expect } from 'vitest';
import {
  parseFilterTuplesParam,
  serializeFilterTuples,
  parseColumnsParam,
  serializeColumns,
  mergeFilters,
  effectiveFilters,
  normalizeListParams,
  parseUrlFilter,
  objectFilterToTuples,
  type FilterTuple,
} from '@/lib/filter-from-url';
import {
  operatorsForFieldtype,
  operatorArity,
  assertValidTuple,
  filterableFields,
  standardFilterFields,
} from '@/lib/filter-operators';
import type { FieldDefinition } from '@digitaplatform/shared';

describe('?f / ?of tuple codec', () => {
  it('round-trips tuple arrays', () => {
    const t: FilterTuple[] = [['status', '=', 'open'], ['total', '>=', 100]];
    expect(parseFilterTuplesParam(serializeFilterTuples(t)!)).toEqual(t);
  });
  it('empty → undefined (serialize) / [] (parse)', () => {
    expect(serializeFilterTuples([])).toBeUndefined();
    expect(parseFilterTuplesParam(null)).toEqual([]);
  });
  it('malformed whole param → []', () => {
    expect(parseFilterTuplesParam('{not json')).toEqual([]);
    expect(parseFilterTuplesParam(JSON.stringify({ a: 1 }))).toEqual([]);
  });
  it('drops a single malformed tuple, keeps the valid ones', () => {
    const raw = JSON.stringify([['ok', '=', 1], ['bad'], ['x', 5, 'y']]);
    expect(parseFilterTuplesParam(raw)).toEqual([['ok', '=', 1]]);
  });
});

describe('?cols codec', () => {
  it('round-trips CSV preserving order', () => {
    expect(parseColumnsParam(serializeColumns(['b', 'a', 'c'])!)).toEqual(['b', 'a', 'c']);
  });
  it('empty → undefined / []', () => {
    expect(serializeColumns([])).toBeUndefined();
    expect(parseColumnsParam(null)).toEqual([]);
  });
});

describe('mergeFilters (N-per-field)', () => {
  it('keeps multiple ops on the same field, dedups identical', () => {
    const a: FilterTuple[] = [['total', '>=', 10]];
    const b: FilterTuple[] = [['total', '<=', 99], ['total', '>=', 10]];
    expect(mergeFilters(a, b)).toEqual([['total', '>=', 10], ['total', '<=', 99]]);
  });
});

describe('effectiveFilters (nav vs bar override)', () => {
  const nav: FilterTuple[] = [['kind', '=', 'a']];
  const ui: FilterTuple[] = [['status', '=', 'open']];
  it('bar active → drops the nav seed', () => {
    expect(effectiveFilters(nav, ui, true)).toEqual(ui);
  });
  it('bar inactive → merges nav + ui', () => {
    expect(effectiveFilters(nav, ui, false)).toEqual([['kind', '=', 'a'], ['status', '=', 'open']]);
  });
});

describe('nav ?filter object path (back-compat, unchanged)', () => {
  it('object → "=" / "in" tuples', () => {
    expect(objectFilterToTuples(parseUrlFilter(JSON.stringify({ is_active: true, kind: ['a', 'b'] })))).toEqual([
      ['is_active', '=', true],
      ['kind', 'in', ['a', 'b']],
    ]);
  });
});

describe('normalizeListParams', () => {
  it('sorts filters + or_filters by full key, preserves field projection order, drops empties', () => {
    const out = normalizeListParams({
      page: 0,
      fields: ['z', 'a'],
      filters: [['b', '=', 1], ['a', '=', 2]],
      or_filters: [['y', '=', 1], ['x', '=', 2]],
    });
    expect(out).toEqual({
      fields: ['z', 'a'],
      filters: [['a', '=', 2], ['b', '=', 1]],
      or_filters: [['x', '=', 2], ['y', '=', 1]],
    });
  });
});

describe('filter-operators matrix', () => {
  it('text default is like; numeric supports between; check only =', () => {
    expect(operatorsForFieldtype('Data')[0]).toBe('like');
    expect(operatorsForFieldtype('Int')).toContain('between');
    expect(operatorsForFieldtype('Check')).toEqual(['=']);
    expect(operatorsForFieldtype('JSON')).toEqual(['is']);
    expect(operatorsForFieldtype('Table')).toEqual([]);
  });
  it('arity', () => {
    expect(operatorArity('between')).toBe('range');
    expect(operatorArity('in')).toBe('multi');
    expect(operatorArity('is')).toBe('presence');
    expect(operatorArity('=')).toBe('single');
  });
  it('assertValidTuple throws on an out-of-whitelist operator', () => {
    expect(() => assertValidTuple(['x', 'nope', 1])).toThrow();
    expect(() => assertValidTuple(['x', '>=', 1])).not.toThrow();
  });
  it('filterableFields excludes layout/Table/ReadOnly; standardFilterFields needs the flag', () => {
    const fields = [
      { fieldname: 'a', fieldtype: 'Data', label: 'A', in_standard_filter: true },
      { fieldname: 'sb', fieldtype: 'SectionBreak', label: '' },
      { fieldname: 't', fieldtype: 'Table', label: 'T' },
      { fieldname: 'r', fieldtype: 'ReadOnly', label: 'R' },
      { fieldname: 'b', fieldtype: 'Int', label: 'B' },
    ] as FieldDefinition[];
    expect(filterableFields({ fields }).map((f) => f.fieldname)).toEqual(['a', 'b']);
    expect(standardFilterFields({ fields }).map((f) => f.fieldname)).toEqual(['a']);
  });
});
