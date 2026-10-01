// @vitest-environment jsdom
// A Signature child field of a Table. The pad a person signs on is larger than a grid row, so
// the field is signed in the row dialog and never in its cell, and the cell shows the signature
// as a small image, never the PNG data URL it is stored as.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// The registry would load the controls lazily; the Signature field gets the real
// SignatureControl at once, wherever it is edited, and any other field a plain input.
vi.mock('@/components/render/ControlRenderer', async () => {
  const { default: SignatureControl } = await import('@/controls/SignatureControl');
  return {
    ControlRenderer: (props: FieldControlProps) =>
      props.field.fieldtype === 'Signature' ? (
        <SignatureControl {...props} />
      ) : (
        <input
          aria-label={`edit-${props.field.fieldname}`}
          value={String(props.value ?? '')}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ),
  };
});
vi.mock('@/stores/i18n', () => ({
  useI18nStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      tOption: (_e: string, _f: string, v: string) => v,
    }),
}));
vi.mock('@/stores/session', () => ({
  useSessionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ user: {}, locale: undefined, settings: undefined }),
}));
vi.mock('@/lib/chrome-i18n', () => ({
  useChrome: () => (key: string) => key,
}));

import TableControl from '@/controls/TableControl';

const EDITABLE: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};
const SIGNED = 'data:image/png;base64,c2lnbmVk';
const DRAWN = 'data:image/png;base64,ZHJhd24=';

// jsdom has no canvas: the pad draws on a stand-in, and its drawing encodes as DRAWN.
const pen = {
  setTransform: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
};
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(pen as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(DRAWN);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function deliveriesField(extra: Record<string, unknown> = {}): FieldDefinition {
  return {
    fieldname: 'deliveries',
    fieldtype: 'Table',
    label: 'Deliveries',
    child_fields: [
      { fieldname: 'item', fieldtype: 'Data', label: 'Item' },
      { fieldname: 'signature', fieldtype: 'Signature', label: 'Signature' },
    ],
    ...extra,
  } as unknown as FieldDefinition;
}

function Host({
  field = deliveriesField(),
  state = EDITABLE,
  initialRows,
}: {
  field?: FieldDefinition;
  state?: FieldControlState;
  initialRows: Array<Record<string, unknown>>;
}) {
  const [rows, setRows] = useState<unknown>(initialRows);
  return (
    <TableControl
      field={field}
      value={rows}
      doc={{ docstatus: 0 }}
      entity="Delivery"
      state={state}
      onChange={setRows}
      controlId="deliveries"
      labelId="deliveries-label"
    />
  );
}

function drawStroke(canvas: HTMLElement) {
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 40 });
}

/** Sign the first row in its row dialog, as a person does. */
async function signInRowDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(within(screen.getByRole('grid')).getByRole('button', { name: 'ui.table.editRow' }));
  const dialog = await screen.findByRole('dialog');
  drawStroke(within(dialog).getByRole('img', { name: 'Signature' }));
  await user.click(within(dialog).getByRole('button', { name: 'ui.action.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('a Signature child field of a Table', () => {
  it('shows a stored signature in its cell as a small image, never as its data URL', () => {
    render(<Host initialRows={[{ _row_id: 'r1', item: 'Pen', signature: SIGNED }]} />);

    const grid = screen.getByRole('grid');
    expect(within(grid).getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', SIGNED);
    expect(grid).not.toHaveTextContent('data:image');
  });

  it('shows it as an image in a read-only table too, in the grid and in the cards', () => {
    const { container } = render(
      <Host state={{ ...EDITABLE, readOnly: true }} initialRows={[{ _row_id: 'r1', item: 'Pen', signature: SIGNED }]} />,
    );

    expect(screen.getAllByRole('img', { name: 'ui.signature.alt' })).toHaveLength(2);
    expect(container).not.toHaveTextContent('data:image');
  });

  it('is signed in the row dialog, not in its grid cell', async () => {
    const user = userEvent.setup();
    render(<Host initialRows={[{ _row_id: 'r1', item: 'Pen' }]} />);
    const grid = screen.getByRole('grid');

    // Neither a click nor Enter on the cell puts a pad into the grid.
    const cell = grid.querySelector<HTMLElement>('[data-rc="0-1"]')!;
    await user.click(cell);
    await user.keyboard('{Enter}');
    expect(within(grid).queryByRole('img')).not.toBeInTheDocument();

    await signInRowDialog(user);

    expect(within(grid).getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', DRAWN);
    expect(grid).not.toHaveTextContent('data:image');
  });

  it('takes no pasted text: a paste across the row fills only the other cells', () => {
    render(<Host initialRows={[{ _row_id: 'r1', item: 'Pen' }]} />);
    const grid = screen.getByRole('grid');

    fireEvent.paste(grid, { clipboardData: { getData: () => `Ink\t${SIGNED}` } });

    expect(within(grid).getByText('Ink')).toBeInTheDocument();
    expect(within(grid).queryByRole('img')).not.toBeInTheDocument();
    expect(grid).not.toHaveTextContent('data:image');
  });

  it('is signed in the row dialog of an entry-flow table as well', async () => {
    const user = userEvent.setup();
    render(
      <Host field={deliveriesField({ entry_flow: { sequence: ['item'] } })} initialRows={[{ _row_id: 'r1', item: 'Pen' }]} />,
    );

    await signInRowDialog(user);

    expect(within(screen.getByRole('grid')).getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', DRAWN);
  });

  it('is signed in the row dialog where the detail fields leave it out', async () => {
    const user = userEvent.setup();
    render(<Host field={deliveriesField({ detail_fields: ['item'] })} initialRows={[{ _row_id: 'r1', item: 'Pen' }]} />);

    await signInRowDialog(user);

    expect(within(screen.getByRole('grid')).getByRole('img', { name: 'ui.signature.alt' })).toHaveAttribute('src', DRAWN);
  });

  it('offers no row dialog for a read-only Signature the detail fields leave out', () => {
    const field = deliveriesField({
      detail_fields: ['item'],
      child_fields: [
        { fieldname: 'item', fieldtype: 'Data', label: 'Item' },
        { fieldname: 'signature', fieldtype: 'Signature', label: 'Signature', read_only: true },
      ],
    });
    render(<Host field={field} initialRows={[{ _row_id: 'r1', item: 'Pen', signature: SIGNED }]} />);

    expect(within(screen.getByRole('grid')).queryByRole('button', { name: 'ui.table.editRow' })).not.toBeInTheDocument();
  });
});
