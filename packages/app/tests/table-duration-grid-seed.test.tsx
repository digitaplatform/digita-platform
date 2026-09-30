// @vitest-environment jsdom
// A grid cell editor must know it is in the grid: type one character into a hide_seconds Duration
// cell of the real TableControl grid, commit it with Enter, and read the row value.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import { Suspense, useState } from 'react';
import type { FieldDefinition } from '@digitaplatform/shared';
import TableControl from '@/controls/TableControl';
import type { FieldControlState } from '@/controls/types';

const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => RECT;
  globalThis.ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe(target: Element) {
      const size = [{ inlineSize: RECT.width, blockSize: RECT.height }];
      this.cb([{ target, contentRect: RECT, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = origRect;
  globalThis.ResizeObserver = origRO;
});

const STATE: FieldControlState = { visible: true, required: false, readOnly: false, invalid: false, isComputed: false, isFrozen: false, updating: false };

describe('a typed first character in a hide_seconds Duration grid cell', () => {
  it('is stored in the units the field shows', async () => {
    const field = {
      fieldname: 'lines', fieldtype: 'Table', label: 'Lines',
      child_fields: [{ fieldname: 'wait', fieldtype: 'Duration', label: 'Wait', in_list_view: true, hide_seconds: true }],
    } as unknown as FieldDefinition;
    let latest: Array<Record<string, unknown>> = [];
    function Host() {
      const [rows, setRows] = useState<Array<Record<string, unknown>>>([{ _row_id: 'r1', wait: 600 }]);
      latest = rows;
      return (
        <Suspense fallback={null}>
          <TableControl field={field} value={rows} doc={{}} state={STATE} entity="Widget"
            onChange={(v) => setRows(v as Array<Record<string, unknown>>)} controlId="lines" labelId="lines-label" />
        </Suspense>
      );
    }
    const { container } = render(<Host />);
    const cell = await waitFor(() => {
      const c = Array.from(container.querySelectorAll('[role="gridcell"]')).find((el) => el.textContent === '0:10');
      if (!c) throw new Error('no cell 0:10: ' + Array.from(container.querySelectorAll('[role="gridcell"]')).map((e) => e.textContent).join('|'));
      return c as HTMLElement;
    });
    act(() => { cell.focus(); });
    fireEvent.keyDown(cell, { key: '5' });
    const input = await waitFor(() => {
      const i = container.querySelector('input');
      if (!i) throw new Error('no editor');
      return i as HTMLInputElement;
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => { if (container.querySelector('input')) throw new Error('editor open'); });
    expect(latest[0]!['wait']).toBe(300);
  });

  it('keeps the seeded character when the next one is typed', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const field = {
      fieldname: 'lines', fieldtype: 'Table', label: 'Lines',
      child_fields: [{ fieldname: 'wait', fieldtype: 'Duration', label: 'Wait', in_list_view: true, hide_seconds: true }],
    } as unknown as FieldDefinition;
    let latest: Array<Record<string, unknown>> = [];
    function Host() {
      const [rows, setRows] = useState<Array<Record<string, unknown>>>([{ _row_id: 'r1', wait: 600 }]);
      latest = rows;
      return (
        <Suspense fallback={null}>
          <TableControl field={field} value={rows} doc={{}} state={STATE} entity="Widget"
            onChange={(v) => setRows(v as Array<Record<string, unknown>>)} controlId="lines" labelId="lines-label" />
        </Suspense>
      );
    }
    const { container } = render(<Host />);
    const cell = await waitFor(() => {
      const c = Array.from(container.querySelectorAll('[role="gridcell"]')).find((el) => el.textContent === '0:10');
      if (!c) throw new Error('no cell');
      return c as HTMLElement;
    });
    act(() => { cell.focus(); });
    await user.keyboard('5');
    await waitFor(() => { if (document.activeElement?.tagName !== 'INPUT') throw new Error('editor not focused'); });
    await user.keyboard('0');
    expect(latest[0]!['wait']).toBe(3000);
  });
});
