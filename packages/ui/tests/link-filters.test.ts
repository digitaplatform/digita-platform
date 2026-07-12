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

  it('returns undefined when there are no filters', () => {
    expect(resolveLinkFilters(undefined, { a: 1 })).toBeUndefined();
  });
});
