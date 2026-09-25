import { describe, it, expect } from 'vitest';
import { parseSort, serializeSort, nextSort } from '@/lib/sort';

describe('parseSort / serializeSort', () => {
  it('round-trips a multi-field order_by', () => {
    expect(parseSort('a asc, b desc')).toEqual([
      { field: 'a', dir: 'asc' },
      { field: 'b', dir: 'desc' },
    ]);
    expect(serializeSort([{ field: 'a', dir: 'asc' }, { field: 'b', dir: 'desc' }])).toBe('a asc, b desc');
  });
  it('defaults direction to asc and ignores blanks', () => {
    expect(parseSort('a')).toEqual([{ field: 'a', dir: 'asc' }]);
    expect(parseSort('')).toEqual([]);
    expect(parseSort(undefined)).toEqual([]);
    expect(serializeSort([])).toBeUndefined();
  });
});

describe('nextSort — plain click (single sort)', () => {
  it('a new field becomes the sole sort, ascending', () => {
    expect(nextSort('x asc, y desc', 'z', false)).toBe('z asc');
  });
  it('clicking the sole field toggles its direction', () => {
    expect(nextSort('z asc', 'z', false)).toBe('z desc');
    expect(nextSort('z desc', 'z', false)).toBe('z asc');
  });
  it('collapses a multi-sort down to the clicked field (asc)', () => {
    expect(nextSort('a asc, z desc', 'z', false)).toBe('z asc');
  });
});

describe('nextSort — additive (Shift-click, multi sort)', () => {
  it('adds a new level (asc) and keeps the existing ones', () => {
    expect(nextSort('a asc', 'b', true)).toBe('a asc, b asc');
  });
  it('cycles an existing level asc → desc → removed, in place', () => {
    expect(nextSort('a asc, b asc', 'b', true)).toBe('a asc, b desc');
    expect(nextSort('a asc, b desc', 'b', true)).toBe('a asc');
  });
  it('removing the last level clears the sort (→ default)', () => {
    expect(nextSort('b desc', 'b', true)).toBeUndefined();
  });
});
