// @vitest-environment jsdom
// The add-via-link picker of a Table reads a `$doc.<field>` token of its child Link's target_filters
// from the owning record: the row the pick adds does not exist yet. Both ways a Table opens that
// picker, the link entry field of an entry flow and the add button of a detail-dialog table, must
// hand the owning record to it, or the token is dropped and the picker lists every book.
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
vi.mock('@/components/render/ControlRenderer', () => ({ ControlRenderer: () => null }));
vi.mock('@/components/render/cells', () => ({ CellValue: () => null }));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label }),
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

const BOOK = {
  fieldname: 'book',
  fieldtype: 'Link',
  label: 'Book',
  target: 'Book',
  target_filters: { library: '$doc.library', format: 'print' },
};

function renderLoanLines(layout: Record<string, unknown>) {
  render(
    <TableControl
      field={
        {
          fieldname: 'lines',
          fieldtype: 'Table',
          label: 'Lines',
          add_via_link: 'book',
          child_fields: [BOOK],
          ...layout,
        } as unknown as FieldDefinition
      }
      value={[]}
      doc={{ docstatus: 0, library: 'LIB-2' }}
      entity="Loan"
      state={STATE}
      onChange={() => {}}
      controlId="lines"
      labelId="lines-label"
    />,
  );
}

/** The filters of every search the picker ran; a search it did not enable never reaches the engine. */
const listSentFilters = () => searches.filter((s) => s.enabled).map((s) => s.filters);

beforeEach(() => {
  searches.length = 0;
});

describe("a Table's add-via-link picker", () => {
  it('narrows the search by the owning record when the link entry field opens it', async () => {
    renderLoanLines({ entry_flow: { sequence: [] } });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'ui.link.searchEntity' }), 'dune{Enter}');
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2', format: 'print' });
  });

  it('narrows the search by the owning record when the add button opens it', async () => {
    renderLoanLines({ row_detail_dialog: true });
    await userEvent.setup().click(screen.getByRole('button', { name: 'ui.table.addViaLink' }));
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2', format: 'print' });
  });
});
