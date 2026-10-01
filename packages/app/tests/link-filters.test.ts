import { describe, it, expect } from 'vitest';
import { resolveLinkFilters } from '@/lib/link-filters';

describe('resolveLinkFilters', () => {
  it('passes static filters through unchanged', () => {
    expect(resolveLinkFilters({ domain: 'purchase' }, {})).toEqual({ domain: 'purchase' });
  });

  it('resolves a $doc.<field> token against the document', () => {
    expect(resolveLinkFilters({ country: '$doc.company_country' }, { company_country: 'DE' })).toEqual({
      country: 'DE',
    });
  });

  it('drops an unresolved $doc token so the picker is not over-filtered', () => {
    expect(resolveLinkFilters({ country: '$doc.company_country' }, {})).toBeUndefined();
  });

  it('keeps the resolvable filters when one token drops', () => {
    expect(resolveLinkFilters({ domain: 'sales', country: '$doc.missing' }, {})).toEqual({ domain: 'sales' });
  });

  it('drops a $doc token whose field holds an object or a list, which names no single value', () => {
    const doc = { owner: { $ne: 'nobody' }, tags: ['a', 'b'], region: 'North' };
    expect(
      resolveLinkFilters({ owner: '$doc.owner', tag: '$doc.tags', region: '$doc.region' }, doc),
    ).toEqual({ region: 'North' });
  });

  it('resolves a $doc token whose field holds a number or a boolean', () => {
    expect(resolveLinkFilters({ year: '$doc.year', active: '$doc.active' }, { year: 2026, active: false })).toEqual({
      year: 2026,
      active: false,
    });
  });

  it('returns undefined when there are no filters', () => {
    expect(resolveLinkFilters(undefined, { a: 1 })).toBeUndefined();
  });
});
