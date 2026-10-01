// @vitest-environment jsdom
// A `$doc.<field>` token in the target_filters of a Table's child Link names the owning record, the
// same record the add-via-link picker reads: a row's Link picks among the books of the loan's
// library, whether it is edited in the grid cell or in the row dialog, and never reads the row.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

// The grid draws only the rows its virtualizer measures, and jsdom lays out nothing.
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const ROW_RECT = { ...RECT, height: 36, bottom: 36 } as DOMRect;
const isRow = (el: Element) => el.matches('[data-ui="table-row"]');
const origOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return RECT;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isRow(this) ? ROW_RECT.height : RECT.height;
    },
  });
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      const rect = isRow(target) ? ROW_RECT : RECT;
      const size = [{ inlineSize: rect.width, blockSize: rect.height }];
      this.cb(
        [{ target, contentRect: rect, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffsetHeight);
  globalThis.ResizeObserver = origRO;
});

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
vi.mock('@/hooks/useList', () => ({
  useList: () => ({ data: undefined, isLoading: false, isPlaceholderData: false }),
}));
vi.mock('@/components/render/cells', () => ({ CellValue: () => null }));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ t: (k: string) => k, tField: (_e: string, _f: string, label: string) => label }),
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

/** A loan of library LIB-2 with one line; the line carries a library of its own. */
function renderLoanLines(layout: Record<string, unknown>) {
  render(
    <TableControl
      field={
        {
          fieldname: 'lines',
          fieldtype: 'Table',
          label: 'Lines',
          child_fields: [BOOK, { fieldname: 'library', fieldtype: 'Data', label: 'Library' }],
          ...layout,
        } as unknown as FieldDefinition
      }
      value={[{ _row_id: 'r1', book: '', library: 'LIB-9' }]}
      doc={{ docstatus: 0, library: 'LIB-2' }}
      entity="Loan"
      state={STATE}
      onChange={() => {}}
      controlId="lines"
      labelId="lines-label"
    />,
  );
}

/** The filters of every search the Link ran; a search it did not enable never reaches the engine. */
const listSentFilters = () => searches.filter((s) => s.enabled !== false).map((s) => s.filters);

beforeEach(() => {
  searches.length = 0;
});

describe("a Table row's Link picker", () => {
  it('narrows the search by the owning record in the grid cell', async () => {
    renderLoanLines({});
    const user = userEvent.setup();
    await user.click(screen.getByRole('grid').querySelector<HTMLElement>('[data-rc="0-0"]')!);
    await user.keyboard('{Enter}');
    searches.length = 0;
    await user.type(await within(screen.getByRole('grid')).findByRole('combobox'), 'du');
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2', format: 'print' });
  });

  it('narrows the search by the owning record in the row dialog', async () => {
    renderLoanLines({ row_detail_dialog: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ui.table.editRow' }));
    searches.length = 0;
    await user.type((await within(screen.getByRole('dialog')).findAllByRole('combobox'))[0]!, 'du');
    expect(listSentFilters()).not.toHaveLength(0);
    for (const filters of listSentFilters()) expect(filters).toEqual({ library: 'LIB-2', format: 'print' });
  });
});
