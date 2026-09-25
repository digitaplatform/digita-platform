// @vitest-environment jsdom
// TableControl entry-flow keyboard hygiene: Enter commits a cell WITHOUT
// submitting the record form, a consumed Escape never reverts a pick, and the
// link-entry pick appends a row and opens its first entry_flow cell.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

// ── virtualizer needs measurable layout in jsdom (same stubs as datagrid.test) ──
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return RECT;
  };
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [
          {
            target,
            contentRect: RECT,
            borderBoxSize: [{ inlineSize: 800, blockSize: 480 }],
            contentBoxSize: [{ inlineSize: 800, blockSize: 480 }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

// ── module mocks: registry control → plain input; cells → plain text ──────────
vi.mock('@/components/render/ControlRenderer', () => ({
  ControlRenderer: ({
    field,
    value,
    onChange,
    onCommit,
  }: {
    field: FieldDefinition;
    value: unknown;
    onChange: (v: unknown) => void;
    onCommit?: () => void;
  }) => (
    <input
      aria-label={`edit-${field.fieldname}`}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      data-commit={onCommit ? 'yes' : 'no'}
    />
  ),
}));
vi.mock('@/components/render/cells', () => ({
  // Mirrors the real CellValue's Link branch (per-row `_link_titles` lookup)
  // so the entry-flow test can prove the picked DISPLAY reaches the cell,
  // while every other fieldtype still renders the raw value like before.
  CellValue: ({ field, row }: { field: FieldDefinition; row: Record<string, unknown> }) => {
    if (field.fieldtype === 'Link') {
      const titles = row['_link_titles'] as Record<string, string> | undefined;
      const title = titles?.[field.fieldname];
      return <span>{title ?? String(row[field.fieldname] ?? '')}</span>;
    }
    return <span>{String(row[field.fieldname] ?? '')}</span>;
  },
}));
vi.mock('@/controls/AddViaLinkSearch', () => ({
  AddViaLinkSearch: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (id: string, display?: string) => void;
  }) =>
    open ? (
      <>
        <button aria-label="pick-link" onClick={() => onPick('CHILD-1', 'Widget')}>
          pick CHILD-1
        </button>
        {/* Mirrors a picker result with NO display text (e.g. the search index
            has no title for the hit) — proves the `if (display)` guard in
            addLinkRow degrades to the raw id instead of crashing. */}
        <button aria-label="pick-link-no-display" onClick={() => onPick('CHILD-2')}>
          pick CHILD-2 (no display)
        </button>
      </>
    ) : null,
}));
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
import { stripForSave } from '@/pages/RecordPage';

const STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

const LINES_FIELD: FieldDefinition = {
  fieldname: 'lines',
  fieldtype: 'Table',
  label: 'Lines',
  add_via_link: 'child',
  entry_flow: { sequence: ['qty', 'rate'] },
  grid_columns: ['child', 'qty', 'rate'],
  child_fields: [
    { fieldname: 'child', fieldtype: 'Link', label: 'Child', target: 'Widget' },
    { fieldname: 'qty', fieldtype: 'Float', label: 'Qty' },
    { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate' },
  ],
} as unknown as FieldDefinition;

function Host({
  onSubmit = () => {},
  initialRows = [{ _row_id: 'r1', child: 'CHILD-0', qty: 5, rate: 2 }],
}: {
  onSubmit?: () => void;
  initialRows?: Array<Record<string, unknown>>;
}) {
  const [rows, setRows] = useState<unknown>(initialRows);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <TableControl
        field={LINES_FIELD}
        value={rows}
        doc={{ docstatus: 0 }}
        row={undefined}
        parentDoc={undefined}
        entity="Widget"
        state={STATE}
        onChange={setRows}
        controlId="lines"
        labelId="lines-label"
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe('TableControl entry flow', () => {
  it('Enter commits a Float cell without submitting the record form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    // Activate the qty cell (display value 5), then Enter to commit.
    await user.click(screen.getByText('5'));
    const editor = await screen.findByLabelText('edit-qty');
    await user.clear(editor);
    await user.type(editor, '7');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByLabelText('edit-qty')).not.toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('a consumed Escape (defaultPrevented) does NOT revert the cell edit', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByText('5'));
    const editor = await screen.findByLabelText('edit-qty');
    await user.clear(editor);
    await user.type(editor, '9');
    // Simulate a Combobox that already used this Escape to close its popup.
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    evt.preventDefault();
    fireEvent(editor, evt);
    // Value must still be the edited one (no editStartRef revert).
    expect((screen.getByLabelText('edit-qty') as HTMLInputElement).value).toBe('9');
  });

  it('plain Escape still cancels and reverts the cell edit', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByText('5'));
    const editor = await screen.findByLabelText('edit-qty');
    await user.clear(editor);
    await user.type(editor, '9');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('edit-qty')).not.toBeInTheDocument());
    expect(screen.getByText('5')).toBeInTheDocument(); // reverted
  });

  it('link pick appends a row and opens the FIRST entry_flow cell (editCell deferral)', async () => {
    const user = userEvent.setup();
    render(<Host initialRows={[]} />);
    // The persistent entry input renders below the grid; typing + Enter opens
    // the (mocked) search dialog, whose pick appends the row.
    const entry = screen.getByRole('textbox');
    await user.type(entry, 'CHI');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByLabelText('pick-link'));
    // New row is in the grid AND the qty editor (sequence[0]) is open.
    const cell = await screen.findByLabelText('edit-qty');
    expect(cell).toBeInTheDocument();
    expect(document.activeElement, 'focus must land in the qty cell after a pick').toBe(cell);
  });

  it('focus lands on the qty editor once a just-appended row (virtualized out of view) scrolls in', async () => {
    // Reproduces the real A-Q002 gap without relying on jsdom's non-functional
    // `Element.scrollTo` (the virtualizer's `scrollToIndex` is a no-op in
    // jsdom — it never fires a 'scroll' event, so the row stays un-rendered
    // until we simulate the browser having scrolled it into view). With
    // enough existing rows, the freshly-appended row starts outside the
    // virtualized window: `active` flips true before the row (and its input)
    // mount, so a focus effect keyed only on `active` fires too early and
    // finds nothing to focus.
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, i) => ({
      _row_id: `r${i}`,
      child: `EXISTING-${i}`,
      qty: 1,
      rate: 1,
    }));
    render(<Host initialRows={many} />);
    const entry = screen.getByRole('textbox');
    await user.type(entry, 'CHI');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByLabelText('pick-link'));
    // The appended row (index 60) is well past the initial virtualized window
    // (~22 rows at the default 36px row height / 480px body) — its editor is
    // not mounted yet.
    expect(screen.queryByLabelText('edit-qty')).not.toBeInTheDocument();
    // Simulate the browser finishing the `scrollToIndex` the deferred edit
    // requested: move the grid's scroll container and dispatch the 'scroll'
    // event the virtualizer listens for.
    const scrollEl = screen.getByRole('grid').parentElement as HTMLElement;
    scrollEl.scrollTop = 1716; // brings row 60 (last row, 61 rows * 36px) into view
    fireEvent.scroll(scrollEl);
    // The row is now mounted AND focus must have landed in its qty cell.
    const cell = await screen.findByLabelText('edit-qty');
    expect(document.activeElement, 'focus must land in the qty cell once the deferred row mounts').toBe(cell);
  });

  it('does NOT snap the scroll back when the user scrolls the already-focused active cell out of view', async () => {
    // Guards the one-shot fix (`surfacedRef` in DataGrid): once the active cell
    // has actually been focused, a LATER `virtualItems` change caused by a
    // genuine user scroll (not the deferred append flow above) must not
    // re-trigger `virtualizer.scrollToIndex` to pin the view back to it — that
    // would fight a deliberate scroll-away while the cell is still mid-edit.
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, i) => ({
      _row_id: `r${i}`,
      child: `CHILD-${i}`,
      qty: i + 100, // unique per row so the click target is unambiguous
      rate: 1,
    }));
    render(<Host initialRows={many} />);
    // Activate + focus row 0's qty cell — well within the initial
    // virtualized window, so focus lands synchronously (already "surfaced").
    await user.click(screen.getByText('100'));
    const editor = await screen.findByLabelText('edit-qty');
    expect(document.activeElement).toBe(editor);

    const scrollEl = screen.getByRole('grid').parentElement as HTMLElement;
    const scrollToSpy = vi.fn();
    scrollEl.scrollTo = scrollToSpy;

    // A real user scrolls all the way to the bottom — row 0 (still the active,
    // mid-edit cell) leaves the rendered window entirely.
    scrollEl.scrollTop = 1680; // 60 rows * 36px - 480px viewport
    fireEvent.scroll(scrollEl);
    await waitFor(() => expect(screen.queryByLabelText('edit-qty')).not.toBeInTheDocument());

    // The grid must not have tried to scroll back to pin the (still active,
    // now off-screen) cell in view.
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('link pick shows the picked DISPLAY in the CHILD cell, not the raw id', async () => {
    const user = userEvent.setup();
    render(<Host initialRows={[]} />);
    const entry = screen.getByRole('textbox');
    await user.type(entry, 'CHI');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByLabelText('pick-link'));
    // The new row's CHILD cell renders the picked title, not the ObjectId.
    expect(await screen.findByText('Widget')).toBeInTheDocument();
    expect(screen.queryByText('CHILD-1')).not.toBeInTheDocument();
  });

  it('link pick with NO display falls back to the raw id in the CHILD cell (no crash)', async () => {
    const user = userEvent.setup();
    render(<Host initialRows={[]} />);
    const entry = screen.getByRole('textbox');
    await user.type(entry, 'CHI');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByLabelText('pick-link-no-display'));
    // No display was provided → the `if (display)` guard in addLinkRow skips
    // seeding `_link_titles`, so the cell degrades to the raw id instead of crashing.
    expect(await screen.findByText('CHILD-2')).toBeInTheDocument();
  });
});

describe('stripForSave (per-row _link_titles transience)', () => {
  const META: EntityDefinition = {
    name: 'Widget',
    label: 'Widget',
    database: 'app',
    fields: [
      { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
      {
        fieldname: 'lines',
        fieldtype: 'Table',
        label: 'Lines',
        child_fields: [
          { fieldname: 'child', fieldtype: 'Link', label: 'Child', target: 'Widget' },
          { fieldname: 'qty', fieldtype: 'Float', label: 'Qty' },
        ],
      },
    ],
    permissions: [],
    is_submittable: false,
  } as unknown as EntityDefinition;

  it('strips the top-level `_link_titles` (unchanged pre-existing behavior)', () => {
    const out = stripForSave(META, { note: 'a', _link_titles: { note: 'A' } });
    expect(out).not.toHaveProperty('_link_titles');
  });

  it('strips `_link_titles` from EVERY row of a Table field before save', () => {
    const values = {
      note: 'a',
      lines: [
        { _row_id: 'r1', child: 'CHILD-1', qty: 5, _link_titles: { child: 'Widget' } },
        { _row_id: 'r2', child: 'CHILD-2', qty: 2 },
      ],
    };
    const out = stripForSave(META, values);
    const lines = out['lines'] as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    for (const row of lines) expect(row).not.toHaveProperty('_link_titles');
    // The rest of the row survives untouched.
    expect(lines[0]).toMatchObject({ _row_id: 'r1', child: 'CHILD-1', qty: 5 });
    expect(lines[1]).toMatchObject({ _row_id: 'r2', child: 'CHILD-2', qty: 2 });
  });
});
