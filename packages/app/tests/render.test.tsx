// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Suspense } from 'react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { ListRenderer } from '@/components/render/ListRenderer';
import TableControl from '@/controls/TableControl';
import type { FieldControlState } from '@/controls/types';

afterEach(cleanup);

// jsdom has no layout, so the kit grid's virtualizer would measure a 0px viewport and
// mount no rows: give it a measurable rect and a ResizeObserver for this file.
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
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

const noop = () => {};

function meta(fields: Partial<FieldDefinition>[], extra: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: 'Widget',
    label: 'Widget',
    label_plural: 'Widgets',
    title_field: 'name',
    fields,
    permissions: [],
    ...extra,
  } as unknown as EntityDefinition;
}

describe('ListRenderer (generic meta-driven render)', () => {
  it('renders in_list_view columns + row data from metadata', () => {
    const m = meta([
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
    ]);
    const rows = [
      { _id: 'c1', name: 'Acme', city: 'Berlin' },
      { _id: 'c2', name: 'Globex', city: 'Munich' },
    ];
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={rows}
        page={1}
        total={2}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('City'); // a data-column header (label fallback)
    expect(text).toContain('Acme'); // primary cell
    expect(text).toContain('Berlin'); // data cell value
    // Neither row has a selection model and a click navigates away, so no row claims one.
    const rowHooks = container.querySelectorAll('[data-ui="table-row"], [data-ui="list-row"]');
    expect(rowHooks).toHaveLength(4);
    for (const row of rowHooks) {
      expect(row).not.toHaveAttribute('aria-selected');
      expect(row).not.toHaveAttribute('data-selected');
    }
  });

  it('minimal-app invariant: an entity with no in_list_view fields still renders (primary column)', () => {
    const m = meta([{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }]); // no in_list_view
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={[{ _id: 'c1', name: 'Acme' }]}
        page={1}
        total={1}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    expect(container.textContent ?? '').toContain('Acme');
  });

  it('without a title field the primary column shows the id and keeps its col:_id handle', () => {
    const m = meta([{ fieldname: 'name', fieldtype: 'Data', label: 'Name' }], { title_field: undefined });
    const { container } = render(
      <ListRenderer entity="Widget" meta={m} rows={[{ _id: 'c1', name: 'Acme' }]} page={1} total={1} totalPages={1} onRowClick={noop} onSort={noop} onPageChange={noop} />,
    );
    expect(container.querySelector('[data-testid="col:_id"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="row:c1"]')?.textContent).toBe('c1');
  });

  it('keeps every chosen column when they do not fit the frame, scrolling instead of collapsing', () => {
    // jsdom reports every clientWidth as 0; the kit grid reads the frame's width from it.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    try {
      const m = meta(['name', 'city', 'phone', 'street', 'zip'].map((fieldname) => ({ fieldname, fieldtype: 'Data', label: fieldname, in_list_view: true })));
      const { container } = render(
        <ListRenderer
          entity="Widget"
          meta={m}
          rows={[{ _id: 'c1', name: 'Acme', city: 'Berlin', phone: '123', street: 'Ring 1', zip: '10115' }]}
          page={1}
          total={1}
          totalPages={1}
          onRowClick={noop}
          onSort={noop}
          onPageChange={noop}
          rowActions={() => <button type="button">print</button>}
        />,
      );
      // 5 fields + the actions column; nothing hides behind a "+n" chip.
      expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(6);
      expect(container.querySelector('[data-ui="grid-collapsed-chip"]')).toBeNull();
      expect(container.querySelector('[role="gridcell"] button')?.textContent).toBe('Acme');
      expect(container.textContent).toContain('print');
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
    }
  });

  it('visibleColumns override controls which data columns appear', () => {
    const m = meta([
      { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
      { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
      { fieldname: 'phone', fieldtype: 'Data', label: 'Phone', in_list_view: true },
    ]);
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={[{ _id: 'c1', name: 'Acme', city: 'Berlin', phone: '123' }]}
        visibleColumns={['phone']}
        page={1}
        total={1}
        totalPages={1}
        onRowClick={noop}
        onSort={noop}
        onPageChange={noop}
      />,
    );
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]')).map((h) => h.textContent ?? '');
    expect(headers.some((h) => h.includes('Phone'))).toBe(true);
    expect(headers.some((h) => h.includes('City'))).toBe(false); // excluded by the override
  });

  it('draws the rows through the kit grid and cards: selected row, sort click, status badge', () => {
    const onSort = vi.fn();
    const m = meta(
      [
        { fieldname: 'name', fieldtype: 'Data', label: 'Name', in_list_view: true },
        { fieldname: 'city', fieldtype: 'Data', label: 'City', in_list_view: true },
      ],
      { states: [{ value: 'open', color: 'green' }, { value: 'handover', color: 'cyan' }] },
    );
    const rows = [
      { _id: 'c1', name: 'Acme', city: 'Berlin', status: 'open' },
      { _id: 'c2', name: 'Globex', city: 'Munich', status: 'handover' },
    ];
    const { container } = render(
      <ListRenderer
        entity="Widget"
        meta={m}
        rows={rows}
        orderBy="city desc, name asc"
        page={1}
        total={2}
        totalPages={1}
        selectedRowId="c2"
        onRowClick={noop}
        onSort={onSort}
        onPageChange={noop}
      />,
    );
    // The desktop grid: the kit hooks, the row of the current record selected.
    const table = container.querySelector('[data-testid="list-table"] [data-ui="table"]')!;
    expect(table).toBeTruthy();
    const gridRows = table.querySelectorAll('[data-ui="table-row"]');
    expect(gridRows).toHaveLength(2);
    expect(gridRows[0]).toHaveAttribute('aria-selected', 'false');
    expect(gridRows[1]).toHaveAttribute('aria-selected', 'true');
    // The e2e handles stay: the row by id, the column by fieldname.
    expect(gridRows[1]!.querySelector('[data-testid="row:c2"]')).toBeTruthy();
    const city = container.querySelector('[data-testid="col:city"]')!;
    expect(city).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(city.querySelector('button')!, { shiftKey: true });
    expect(onSort).toHaveBeenCalledWith('city', true);
    // The title column sorts by the title field itself, so the server knows the name.
    const name = container.querySelector('[data-testid="col:name"]')!;
    expect(name).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(name.querySelector('button')!);
    expect(onSort).toHaveBeenCalledWith('name', false);
    // The status pill is the kit badge, toned by the state's color.
    const badge = gridRows[0]!.querySelector('[data-ui="badge"]')!;
    expect(badge).toHaveAttribute('data-color', 'success');
    expect(badge.textContent).toBe('open');
    // A cool hue the kit gives no meaning of its own shares the informational tone.
    expect(gridRows[1]!.querySelector('[data-ui="badge"]')).toHaveAttribute('data-color', 'info');
    // The phone cards: the kit list, the current record's card marked.
    const cards = container.querySelectorAll('[data-ui="list-group"] [data-ui="list-row"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('aria-selected', 'false');
    expect(cards[1]).toHaveAttribute('aria-selected', 'true');
  });
});

const CELL_STATE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

describe('TableControl per-row required indicator', () => {
  it("marks a column with mandatory_depends_on (or static required) with an asterisk", () => {
    const field = {
      fieldname: 'lines',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: [
        { fieldname: 'code', fieldtype: 'Data', label: 'Code', mandatory_depends_on: "eval:doc.type=='x'" },
        { fieldname: 'note', fieldtype: 'Data', label: 'Note' },
      ],
    } as unknown as FieldDefinition;
    const { container } = render(
      <Suspense fallback={null}>
        <TableControl
          field={field}
          value={[]}
          doc={{}}
          state={CELL_STATE}
          entity="Widget"
          onChange={noop}
          controlId="lines"
          labelId="lines-label"
        />
      </Suspense>,
    );
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const acc = headers.find((h) => h.textContent?.includes('Code'));
    const note = headers.find((h) => h.textContent?.includes('Note'));
    expect(acc?.textContent).toContain('*'); // mandatory_depends_on → may be required
    expect(note?.textContent).not.toContain('*'); // plain optional → no marker
  });
});
