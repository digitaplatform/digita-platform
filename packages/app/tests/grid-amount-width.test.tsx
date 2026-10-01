// @vitest-environment jsdom
// At a window 1295 px wide the invoice list and the invoice lines cut their amounts: "CHF 40....".
// An amount is the one value a person must read whole, so an amount column is never narrower than
// its widest amount; a column too wide for the window scrolls instead of cutting it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { ListRenderer } from '@/components/render/ListRenderer';
import TableControl from '@/controls/TableControl';
import type { FieldControlState } from '@/controls/types';
import { useSessionStore } from '@/stores/session';
import { formatCurrency } from '@/lib/format';

// The window of the case: the list frame takes the width of the page, so the grid lays out at it.
const RECT = { width: 1295, height: 700, top: 0, left: 0, right: 1295, bottom: 700, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
      this.cb([{ target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  useSessionStore.setState({ locale: { code: 'de', format_locale: 'de-CH' }, settings: { default_currency: 'CHF' } } as never);
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
  useSessionStore.setState({ locale: null, settings: null });
});
afterEach(cleanup);

/** The narrowest a cell may be to show a text of text-sm figures whole: a figure of the app's
 *  fonts is at most 0.6 of the font size wide, and a cell pads 12 px on each side. */
function widthToShow(text: string): number {
  return text.length * 0.6 * 14 + 24;
}

/** The minimum width the grid gives each column, read from the header row's template. */
function columnMinima(container: HTMLElement): Record<string, number> {
  const header = container.querySelector('[role="row"]') as HTMLElement;
  const minima = [...header.style.gridTemplateColumns.matchAll(/minmax\((\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const labels = [...header.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent ?? '');
  return Object.fromEntries(labels.map((label, i) => [label, minima[i]!]));
}

const amount = (value: number) => formatCurrency(value, 'de-CH', 'CHF');

describe('an amount column of a grid at 1295 px', () => {
  it('in the invoice list is as wide as its widest amount', () => {
    const fields = [
      { fieldname: 'customer', fieldtype: 'Data', label: 'Customer', in_list_view: true },
      { fieldname: 'status', fieldtype: 'Data', label: 'Status', in_list_view: true },
      { fieldname: 'posting_date', fieldtype: 'Date', label: 'Date', in_list_view: true },
      { fieldname: 'grand_total', fieldtype: 'Currency', label: 'Total', in_list_view: true },
      { fieldname: 'paid', fieldtype: 'Currency', label: 'Paid', in_list_view: true },
      { fieldname: 'outstanding', fieldtype: 'Currency', label: 'Due', in_list_view: true },
      { fieldname: 'note', fieldtype: 'Data', label: 'Note', in_list_view: true },
    ] as FieldDefinition[];
    const meta = { name: 'Invoice', label: 'Invoice', fields, permissions: [] } as unknown as EntityDefinition;
    const rows = [
      { _id: 'INV-1', customer: 'Anna Muster', grand_total: 40.75, paid: 40.75, outstanding: 0 },
      { _id: 'INV-2', customer: 'Velo Zürich AG', grand_total: 12480.5, paid: 1240.75, outstanding: 11239.75 },
    ];
    const noop = () => {};
    const { container } = render(
      <ListRenderer entity="Invoice" meta={meta} rows={rows} page={1} total={2} totalPages={1} onRowClick={noop} onSort={noop} onPageChange={noop} />,
    );
    const minima = columnMinima(container);
    expect(minima['Total']).toBeGreaterThanOrEqual(widthToShow(amount(12480.5)));
    expect(minima['Paid']).toBeGreaterThanOrEqual(widthToShow(amount(1240.75)));
    expect(minima['Due']).toBeGreaterThanOrEqual(widthToShow(amount(11239.75)));
  });

  it('in the invoice lines is as wide as its widest amount, its total included', async () => {
    const childFields = [
      { fieldname: 'item', fieldtype: 'Data', label: 'Item' },
      { fieldname: 'qty', fieldtype: 'Float', label: 'Qty' },
      { fieldname: 'rate', fieldtype: 'Currency', label: 'Rate' },
      { fieldname: 'amount', fieldtype: 'Currency', label: 'Amount' },
    ] as FieldDefinition[];
    const field = {
      fieldname: 'items',
      fieldtype: 'Table',
      label: 'Lines',
      child_fields: childFields,
      footer: [{ column: 'amount', field: 'net_total' }],
    } as unknown as FieldDefinition;
    const rows = [
      { _row_id: 'r1', item: 'Chain', qty: 1, rate: 40.75, amount: 40.75 },
      { _row_id: 'r2', item: 'Service', qty: 3, rate: 412.25, amount: 1236.75 },
    ];
    const state: FieldControlState = { visible: true, required: false, readOnly: true, invalid: false, isComputed: false, isFrozen: false, updating: false };
    const { container, findAllByRole } = render(
      <TableControl field={field} value={rows} doc={{ items: rows, net_total: 12477.5 }} entity="Invoice" state={state} onChange={() => {}} controlId="items" labelId="items-label" />,
    );
    await findAllByRole('row');
    const minima = columnMinima(container);
    expect(minima['Rate']).toBeGreaterThanOrEqual(widthToShow(amount(412.25)));
    expect(minima['Amount']).toBeGreaterThanOrEqual(widthToShow(amount(12477.5)));
  });
});
