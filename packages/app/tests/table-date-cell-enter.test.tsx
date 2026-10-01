// @vitest-environment jsdom
// A Date cell of a Table grid, by keyboard: Enter on the cell opens its editor, Enter on the
// editor opens the date picker, and a pick commits the cell. Tab still commits the cell as it
// does in the other typed cells, so the entry flow moves on.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition } from '@digitaplatform/shared';
import type { FieldControlProps, FieldControlState } from '@/controls/types';

// ── the grid virtualizes its rows, which needs measurable layout in jsdom ──
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

// The Date cell gets the real DateControl; the registry would load it lazily, and a cell that
// is still loading has nothing the grid could focus.
vi.mock('@/components/render/ControlRenderer', async () => {
  const { default: DateControl } = await import('@/controls/DateControl');
  return {
    ControlRenderer: (props: FieldControlProps) =>
      props.field.fieldtype === 'Date' ? (
        <DateControl {...props} />
      ) : (
        <input
          aria-label={`edit-${props.field.fieldname}`}
          value={String(props.value ?? '')}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ),
  };
});
vi.mock('@/components/render/cells', () => ({
  CellValue: ({ field, row }: { field: FieldDefinition; row: Record<string, unknown> }) => (
    <span>{String(row[field.fieldname] ?? '')}</span>
  ),
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ tField: (_e: string, _f: string, label: string) => label }),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: {}, locale: undefined }),
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

const LOANS_FIELD: FieldDefinition = {
  fieldname: 'loans',
  fieldtype: 'Table',
  label: 'Loans',
  child_fields: [
    { fieldname: 'item', fieldtype: 'Data', label: 'Item' },
    { fieldname: 'due', fieldtype: 'Date', label: 'Due' },
  ],
} as unknown as FieldDefinition;

function Host({ onSubmit }: { onSubmit: () => void }) {
  const [rows, setRows] = useState<unknown>([{ _row_id: 'r1', item: 'Pen', due: '2026-09-28' }]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <TableControl
        field={LOANS_FIELD}
        value={rows}
        doc={{ docstatus: 0 }}
        entity="Library"
        state={STATE}
        onChange={setRows}
        controlId="loans"
        labelId="loans-label"
      />
    </form>
  );
}

/** Focus the Date cell and open its editor by keyboard; the editor's picker trigger takes the focus. */
async function openDateEditor(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  screen.getByText('2026-09-28').closest<HTMLElement>('[role="gridcell"]')!.focus();
  await user.keyboard('{Enter}');
  const trigger = document.activeElement as HTMLElement;
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  return trigger;
}

describe('a Date cell of a Table grid', () => {
  it('opens the picker on Enter, and a pick commits the cell', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);

    const trigger = await openDateEditor(user);
    await user.keyboard('{Enter}');

    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('gridcell', { name: (_name, cell) => cell.textContent === '15' }));

    await waitFor(() => expect(trigger).not.toBeInTheDocument());
    expect(screen.getByText('2026-09-15')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still commits and closes on Tab', async () => {
    const user = userEvent.setup();
    render(<Host onSubmit={() => {}} />);

    const trigger = await openDateEditor(user);
    await user.keyboard('{Tab}');

    await waitFor(() => expect(trigger).not.toBeInTheDocument());
    expect(screen.getByText('2026-09-28')).toBeInTheDocument();
  });

  it('names the picker trigger and its calendar by the column label', async () => {
    const user = userEvent.setup();
    render(<Host onSubmit={() => {}} />);

    const trigger = await openDateEditor(user);
    expect(trigger).toHaveAccessibleName('Due');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Due' })).toBeInTheDocument();
  });

  it('names each column header by its own label only (innocent case)', () => {
    render(<Host onSubmit={() => {}} />);
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Due' })).toBeInTheDocument();
  });
});
