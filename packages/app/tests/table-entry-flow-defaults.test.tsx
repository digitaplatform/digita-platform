// @vitest-environment jsdom
// A line-entry grid seeds `entry_flow.defaults` onto every row it creates, from a link pick and from
// a scan hit. A technician who books a part on a work order gets quantity 1 without typing it; if the
// defaults were lost, the line would start empty and the stock booking would count nothing. A default
// fills only what the row does not carry yet, so a value the pick or the scan resolved stays.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldDefinition, ScanResolveConfig } from '@digitaplatform/shared';
import type { FieldControlState } from '@/controls/types';

// The grid's virtualizer needs measurable layout, which jsdom has none of.
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

vi.mock('@/components/render/ControlRenderer', () => ({
  ControlRenderer: ({ field, value }: { field: FieldDefinition; value: unknown }) => (
    <input aria-label={`edit-${field.fieldname}`} value={String(value ?? '')} readOnly />
  ),
}));
vi.mock('@/components/render/cells', () => ({
  CellValue: ({ field, row }: { field: FieldDefinition; row: Record<string, unknown> }) => <span>{String(row[field.fieldname] ?? '')}</span>,
}));
// The search dialog is not under test: its pick is the moment the grid appends the row.
vi.mock('@/controls/AddViaLinkSearch', () => ({
  AddViaLinkSearch: ({ open, onPick }: { open: boolean; onPick: (id: string, display?: string) => void }) =>
    open ? (
      <button aria-label="pick-part" onClick={() => onPick('PART-1', 'Brake pad')}>
        pick
      </button>
    ) : null,
}));
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({}),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (select: (state: Record<string, unknown>) => unknown) => select({ user: {} }),
}));
vi.mock('@/lib/chrome-i18n', () => ({ useChrome: () => (key: string) => key }));

const getViewMock = vi.fn();
vi.mock('@/services/resource', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getView: (...args: unknown[]) => getViewMock(...args),
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

const RESOLVE: ScanResolveConfig = {
  view: 'partByBarcode',
  try: [{ section: 'hit', link: 'partId', fields: { unit: 'unitCode' } }],
};

// `unit` carries a default of its own, which the row already holds when a pick or a scan creates it.
function buildLinesField(entryFlow: Record<string, unknown>, scanEntry?: Record<string, unknown>): FieldDefinition {
  return {
    fieldname: 'lines',
    fieldtype: 'Table',
    label: 'Lines',
    add_via_link: 'part',
    entry_flow: entryFlow,
    scan_entry: scanEntry,
    grid_columns: ['part', 'quantity', 'discount', 'unit', 'warehouse'],
    child_fields: [
      { fieldname: 'part', fieldtype: 'Link', label: 'Part', target: 'Part' },
      { fieldname: 'quantity', fieldtype: 'Float', label: 'Quantity' },
      { fieldname: 'discount', fieldtype: 'Percent', label: 'Discount' },
      { fieldname: 'unit', fieldtype: 'Data', label: 'Unit', default: 'pcs' },
      { fieldname: 'warehouse', fieldtype: 'Data', label: 'Warehouse' },
    ],
  } as unknown as FieldDefinition;
}

const SCAN_ENTRY = { resolve: RESOLVE, match_on: ['part'], quantity_field: 'quantity', field_map: { unit: 'unit' } };

function Host({ field }: { field: FieldDefinition }) {
  const [rows, setRows] = useState<unknown>([]);
  return (
    <div>
      <TableControl
        field={field}
        value={rows}
        doc={{ docstatus: 0 }}
        row={undefined}
        parentDoc={undefined}
        entity="WorkOrder"
        state={STATE}
        onChange={setRows}
        controlId="lines"
        labelId="lines-label"
      />
      <pre data-testid="rows-dump">{JSON.stringify(rows)}</pre>
    </div>
  );
}

function readRows(): Array<Record<string, unknown>> {
  return JSON.parse(screen.getByTestId('rows-dump').textContent || '[]');
}

async function pickPart(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('entry:WorkOrder:lines'), 'bra');
  await user.keyboard('{Enter}');
  await user.click(await screen.findByLabelText('pick-part'));
  await waitFor(() => expect(readRows()).toHaveLength(1));
  return readRows()[0]!;
}

async function scanCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.type(screen.getByTestId('scan:WorkOrder:lines'), code);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(readRows()).toHaveLength(1));
  return readRows()[0]!;
}

beforeEach(() => {
  getViewMock.mockReset();
  getViewMock.mockResolvedValue({ data: { sections: { hit: [{ partId: 'PART-9', unitCode: 'kg' }] } } });
});

describe('entry_flow.defaults on a link pick', () => {
  it('seeds every default onto the row the pick appends, a zero included', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'], defaults: { quantity: 1, discount: 0, warehouse: 'MAIN' } })} />);

    const row = await pickPart(user);

    expect(row.part).toBe('PART-1');
    expect(row.quantity).toBe(1);
    expect(row.discount).toBe(0);
    expect(row.warehouse).toBe('MAIN');
  });

  it('keeps the link the pick set and the value the row already carries', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'], defaults: { part: 'PART-OTHER', unit: 'box', quantity: 1 } })} />);

    const row = await pickPart(user);

    expect(row.part).toBe('PART-1');
    expect(row.unit).toBe('pcs');
    expect(row.quantity).toBe(1);
  });

  it('adds no value the flow does not declare', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'] })} />);

    const row = await pickPart(user);

    expect(row.part).toBe('PART-1');
    expect(row).not.toHaveProperty('quantity');
    expect(row).not.toHaveProperty('warehouse');
  });
});

describe('entry_flow.defaults on a scan hit', () => {
  it('seeds every default onto the row the hit adds, a zero included', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'], defaults: { discount: 0, warehouse: 'MAIN' } }, SCAN_ENTRY)} />);

    const row = await scanCode(user, '4012345678901');

    expect(row.part).toBe('PART-9');
    expect(row.discount).toBe(0);
    expect(row.warehouse).toBe('MAIN');
  });

  it('keeps the quantity and the mapped value the scan resolved', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'], defaults: { quantity: 1, unit: 'box', warehouse: 'MAIN' } }, SCAN_ENTRY)} />);

    const row = await scanCode(user, '3*4012345678901');

    expect(row.quantity).toBe(3);
    expect(row.unit).toBe('kg');
    expect(row.warehouse).toBe('MAIN');
  });

  it("keeps the field's default where the hit carries no mapped value", async () => {
    // The form sends a seeded default the row lost as null, an explicit clear, so a hit without
    // the value must leave the default in place.
    getViewMock.mockResolvedValue({ data: { sections: { hit: [{ partId: 'PART-9' }] } } });
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'] }, SCAN_ENTRY)} />);
    const row = await scanCode(user, '4012345678901');
    expect([row.part, row.unit]).toEqual(['PART-9', 'pcs']);
  });

  it('adds no value the flow does not declare', async () => {
    const user = userEvent.setup();
    render(<Host field={buildLinesField({ sequence: ['quantity'] }, SCAN_ENTRY)} />);

    const row = await scanCode(user, '4012345678901');

    expect(row.part).toBe('PART-9');
    expect(row.quantity).toBe(1);
    expect(row).not.toHaveProperty('warehouse');
    expect(row).not.toHaveProperty('discount');
  });
});
