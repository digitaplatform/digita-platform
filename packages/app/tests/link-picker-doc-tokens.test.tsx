// @vitest-environment jsdom
// A `$doc.<field>` token in a Link field's target_filters names a field of the document a picker
// works for. The add-via-link picker reads it from the owning record; the list filter editor has no
// document, so it drops the token. Neither may send the literal token to the link search: the engine
// compares the field with the text "$doc.<field>", and the picker shows no row at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { FilterTuple } from '@/lib/filter-from-url';

const searches = vi.hoisted(() => [] as Array<{ filters?: Record<string, unknown>; enabled?: boolean }>);
vi.mock('@/hooks/useSearchLink', () => ({
  useSearchLink: (params: { filters?: Record<string, unknown>; enabled?: boolean }) => {
    searches.push(params);
    return { data: [], isLoading: false };
  },
}));
vi.mock('@/hooks/useMeta', () => ({
  useMeta: () => ({ data: { name: 'Book', search_fields: ['title'], fields: [] } }),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label, tOption: (_e: string, _f: string, o: string) => o }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import { AddViaLinkSearch } from '@/controls/AddViaLinkSearch';
import { FilterEditor } from '@/components/list/FilterEditor';

const BOOK = {
  fieldname: 'book',
  fieldtype: 'Link',
  label: 'Book',
  target: 'Book',
  target_filters: { library: '$doc.library', format: 'print' },
} as FieldDefinition;

/** The filters of every search a picker ran; a search it did not enable never reaches the engine. */
const listSentFilters = () => searches.filter((s) => s.enabled).map((s) => s.filters);

beforeEach(() => {
  searches.length = 0;
});

describe('the add-via-link picker', () => {
  it('narrows the search by the field of the owning record that a $doc token names', () => {
    render(<AddViaLinkSearch open onClose={() => {}} linkField={BOOK} doc={{ library: 'LIB-2' }} onPick={() => {}} />);
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2', format: 'print' });
  });

  it('drops a $doc token whose field the owning record leaves empty and keeps the static entries', () => {
    render(<AddViaLinkSearch open onClose={() => {}} linkField={BOOK} doc={{ library: '' }} onPick={() => {}} />);
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ format: 'print' });
  });
});

describe('the list filter editor', () => {
  it('drops a $doc token, which names no document there, and keeps the static entries', async () => {
    const meta = { name: 'Loan', fields: [BOOK] } as unknown as EntityDefinition;
    render(
      <FilterEditor meta={meta} filter={['book', '=', ''] as FilterTuple} onChange={() => {}} onRemove={() => {}} />,
    );
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'ui.filter.value' }));
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ format: 'print' });
  });
});
