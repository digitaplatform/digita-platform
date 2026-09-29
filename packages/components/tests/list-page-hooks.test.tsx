import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataGrid, type DataGridColumn } from '../src/composites/DataGrid.js';
import { CardList } from '../src/composites/CardList.js';
import { PageHeader } from '../src/composites/PageHeader.js';
import { Badge } from '../src/primitives/Badge.js';
import { Chip } from '../src/primitives/Chip.js';
import { Input } from '../src/primitives/Input.js';

/** The hooks and states a list page is drawn by: a design reaches its rows, its
 *  status pill, its filter chips and its title only through these. */

// jsdom lays nothing out: give the virtualizer a viewport so rows mount.
const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
      const entry = { target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size };
      this.cb([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

const ROWS = [
  { id: 'SO-0043', customer: 'Nordlicht Media' },
  { id: 'SO-0042', customer: 'ACME GmbH' },
];

/** The one check every element below passes: it carries the hook a design draws it by. */
function expectHooked(el: Element | null, hook: string) {
  expect(el, `an element hooked as ${hook}`).not.toBeNull();
  expect(el!.getAttribute('data-ui'), `hook of <${el!.tagName.toLowerCase()}>`).toBe(hook);
}

describe('the hook check itself', () => {
  it('planted: an element drawn without its hook goes red beside a hooked one', () => {
    render(
      <>
        <Badge>hooked</Badge>
        <span data-color="neutral">unhooked</span>
      </>,
    );
    expectHooked(screen.getByText('hooked'), 'badge');
    expect(() => expectHooked(screen.getByText('unhooked'), 'badge')).toThrow(/hook of <span>/);
  });
});

describe('DataGrid as a list', () => {
  const COLS: DataGridColumn[] = [
    { key: 'id', label: 'Number', kind: 'link', sortable: true, headerProps: { 'data-testid': 'col:id' } },
    { key: 'customer', label: 'Customer', kind: 'text' },
  ];

  it('marks the selected row and reports a sortable header click with its Shift state', () => {
    const onSort = vi.fn();
    render(
      <DataGrid
        rows={ROWS}
        columns={COLS}
        getRowId={(r) => r.id}
        editable={false}
        selectedRowId="SO-0042"
        sort={[{ key: 'id', dir: 'asc' }]}
        onSort={onSort}
        aria-label="orders"
      />,
    );
    expectHooked(document.querySelector('[data-ui="table"] [role="row"]'), 'table-header');
    const rows = document.querySelectorAll('[data-ui="table"] [role="row"][aria-rowindex]:not([aria-rowindex="1"])');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expectHooked(row, 'table-row'));
    expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');

    const header = screen.getByTestId('col:id');
    expect(header).toHaveAttribute('role', 'columnheader');
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Number' }), { shiftKey: true });
    expect(onSort).toHaveBeenCalledWith('id', true);
    // A column that is not sortable renders no button.
    expect(screen.queryByRole('button', { name: 'Customer' })).toBeNull();
  });

  describe('when the columns do not fit the frame', () => {
    // jsdom reports every clientWidth as 0; the collapse reads the frame's width from it.
    const FRAME_WIDTH = 300;
    const COLS_WIDE: DataGridColumn[] = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, label: key.toUpperCase(), kind: 'text' }));
    beforeAll(() => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => FRAME_WIDTH });
    });
    afterAll(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    });
    const headers = () => document.querySelectorAll('[role="columnheader"]').length;

    it('collapses trailing columns behind a "+n" chip by default', () => {
      render(<DataGrid rows={ROWS} columns={COLS_WIDE} getRowId={(r) => r.id} editable={false} />);
      expect(headers()).toBe(3);
      expect(document.querySelector('[data-ui="grid-collapsed-chip"]')).toHaveTextContent('+2');
    });

    it('keeps every column and scrolls when the consumer asks for columnOverflow="scroll"', () => {
      render(<DataGrid rows={ROWS} columns={COLS_WIDE} getRowId={(r) => r.id} editable={false} columnOverflow="scroll" />);
      expect(headers()).toBe(5);
      expect(document.querySelector('[data-ui="grid-collapsed-chip"]')).toBeNull();
    });
  });
});

describe('CardList', () => {
  it('draws every row as a list-row card in a list-group and marks the current one', () => {
    const onRowClick = vi.fn();
    render(
      <CardList rows={ROWS} getRowId={(r) => r.id} currentRowId="SO-0042" onRowClick={onRowClick} renderCard={(r) => r.customer} />,
    );
    expectHooked(screen.getByRole('list'), 'list-group');
    const cards = screen.getAllByRole('button');
    expect(cards).toHaveLength(2);
    cards.forEach((card) => expectHooked(card, 'list-row'));
    expect(cards[0]).not.toHaveAttribute('aria-current');
    expect(cards[1]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(cards[0]!);
    expect(onRowClick).toHaveBeenCalledWith('SO-0043');
  });
});

describe('the status pill and the filter chips', () => {
  it('badge carries the color a design tones it by', () => {
    render(<Badge variant="pill" color="success">confirmed</Badge>);
    const badge = screen.getByText('confirmed');
    expectHooked(badge, 'badge');
    expect(badge).toHaveAttribute('data-color', 'success');
  });

  it('an applied filter is a selected chip whose only control is its named remove button', () => {
    const onRemove = vi.fn();
    render(
      <Chip selected onRemove={onRemove} removeLabel="Remove filter Status">
        Status: confirmed
      </Chip>,
    );
    const chip = screen.getByText('Status: confirmed');
    expectHooked(chip, 'chip');
    expect(chip).toHaveAttribute('data-selected', 'true');
    // The chip body is not a button: it neither toggles nor removes.
    expect(chip).not.toHaveAttribute('aria-pressed');
    fireEvent.click(chip);
    expect(onRemove).not.toHaveBeenCalled();
    const remove = screen.getByRole('button', { name: 'Remove filter Status' });
    expectHooked(remove, 'chip-remove');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('the chip that opens the filter editor tells its expanded state', () => {
    render(
      <Chip aria-expanded={false} aria-haspopup="dialog">
        Filter
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Filter' });
    expectHooked(chip, 'chip');
    expect(chip).not.toHaveAttribute('data-selected');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('PageHeader of a list', () => {
  it('carries the title, search and actions hooks, and its bar sticks below the top bar', () => {
    render(
      <PageHeader
        title="Sales Orders"
        collapsed={false}
        search={<Input aria-label="Search" />}
        actions={<button type="button">New</button>}
      />,
    );
    const header = screen.getByRole('banner');
    expectHooked(header, 'page-header');
    for (const hook of ['page-header-bar', 'page-header-title', 'page-header-heading', 'page-header-search', 'page-header-actions']) {
      expectHooked(header.querySelector(`[data-ui="${hook}"]`), hook);
    }
    expect(header.querySelector('[data-ui="page-header-bar"]')!.className).toContain('top-[var(--topbar-h,0px)]');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sales Orders');
  });
});
