// @vitest-environment jsdom
// A `$doc.<field>` token in the target_filters of a Table's add_via_link Link names a field of the
// owning record: the row the pick adds does not exist yet. Both pickers of the table, the link-entry
// field of the entry flow and the add dialog of the row-dialog presentation, must narrow by it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

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
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: {} }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import TableControl from '@/controls/TableControl';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

const BOOK: FieldDefinition = {
  fieldname: 'book',
  fieldtype: 'Link',
  label: 'Book',
  target: 'Book',
  target_filters: { library: '$doc.library' },
} as FieldDefinition;

const LINES = {
  fieldname: 'loans',
  fieldtype: 'Table',
  label: 'Loans',
  add_via_link: 'book',
  child_fields: [BOOK, { fieldname: 'qty', fieldtype: 'Int', label: 'Qty' }],
} as unknown as FieldDefinition;

function renderTable(field: FieldDefinition) {
  render(
    <TableControl
      field={field}
      value={[]}
      doc={{ docstatus: 0, library: 'LIB-2', loans: [] }}
      row={undefined}
      parentDoc={undefined}
      entity="Checkout"
      state={STATE}
      onChange={() => {}}
      controlId="loans"
      labelId="loans-label"
    />,
  );
}

/** The filters of every search a picker ran; a search it did not enable never reaches the engine. */
const listSentFilters = () => searches.filter((s) => s.enabled).map((s) => s.filters);

beforeEach(() => {
  searches.length = 0;
});

describe('a Table add_via_link picker', () => {
  it('narrows the link-entry search by the owning record', async () => {
    renderTable({ ...LINES, entry_flow: { sequence: ['qty'] } } as FieldDefinition);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'ui.link.searchField' }), 'atlas{Enter}');
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2' });
  });

  it('narrows the add dialog search by the owning record', async () => {
    renderTable({ ...LINES, row_detail_dialog: true } as FieldDefinition);
    await userEvent.setup().click(screen.getByRole('button', { name: 'ui.table.addViaLink' }));
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2' });
  });
});
