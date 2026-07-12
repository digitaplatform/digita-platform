// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  DataGrid,
  type DataGridColumn,
  type DataGridDisplayArgs,
  type DataGridEditArgs,
} from '@digitaplatform/components';

afterEach(cleanup);

// jsdom has no layout, so the virtualizer's scroll viewport measures 0 and renders
// no rows. Give it a measurable rect (and a ResizeObserver) for the duration of this
// file so windowed rows actually mount, then restore.
const origRect = HTMLElement.prototype.getBoundingClientRect;
const origRO = globalThis.ResizeObserver;
const RECT = { width: 600, height: 480, top: 0, left: 0, right: 600, bottom: 480, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
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
      // react-virtual reads the viewport size from this callback; deliver it at once.
      this.cb(
        [
          {
            target,
            contentRect: RECT,
            borderBoxSize: [{ inlineSize: 600, blockSize: 480 }],
            contentBoxSize: [{ inlineSize: 600, blockSize: 480 }],
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

type Row = Record<string, unknown>;

const COLS: DataGridColumn[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'qty', label: 'Qty', kind: 'number' },
];
const getRowId = (r: Row) => String(r._row_id);
const rows = (): Row[] => [
  { _row_id: 'r1', name: 'Apple', qty: 2 },
  { _row_id: 'r2', name: 'Pear', qty: 5 },
];
const display = ({ row, column }: DataGridDisplayArgs<Row>) => <span>{String(row[column.key] ?? '')}</span>;
const editor = ({ value, onChange, done, cancel }: DataGridEditArgs<Row>) => (
  <input
    aria-label="editor"
    value={String(value ?? '')}
    onChange={(e) => onChange(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        done();
      }
    }}
  />
);

describe('DataGrid', () => {
  it('renders column headers and cell values via renderDisplay', () => {
    const { getAllByRole, getByText } = render(
      <DataGrid<Row> rows={rows()} columns={COLS} getRowId={getRowId} editable={false} renderDisplay={display} />,
    );
    const headers = getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Name');
    expect(headers).toContain('Qty');
    expect(getByText('Apple')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
  });

  it('shows display until a cell is clicked, then swaps to the editor', () => {
    const { getAllByRole, queryByLabelText, getByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
      />,
    );
    expect(queryByLabelText('editor')).toBeNull();
    fireEvent.click(getAllByRole('gridcell')[0]!);
    expect(getByLabelText('editor')).toBeTruthy();
  });

  it('emits a per-_row_id patch when the active cell changes', () => {
    const onCellChange = vi.fn();
    const { getAllByRole, getByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    fireEvent.click(getAllByRole('gridcell')[0]!); // r1 / name
    fireEvent.change(getByLabelText('editor'), { target: { value: 'Banana' } });
    expect(onCellChange).toHaveBeenCalledWith({ rowId: 'r1', fieldname: 'name', value: 'Banana' });
  });

  it('canEditCell=false vetoes every write path on a per-row-locked cell (H15)', () => {
    const onCellChange = vi.fn();
    const { getAllByRole, queryByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
        canEditCell={(rowId, key) => !(rowId === 'r1' && key === 'name')}
      />,
    );
    const cells = getAllByRole('gridcell');
    const locked = cells[0]!; // r1 / name
    // Enter/F2 must not open the editor…
    fireEvent.keyDown(locked, { key: 'Enter' });
    expect(queryByLabelText('editor')).toBeNull();
    // …a printable key must not emit a value (mutate-before-veto)…
    fireEvent.keyDown(locked, { key: 'a' });
    expect(onCellChange).not.toHaveBeenCalled();
    // …and a click must not begin editing.
    fireEvent.click(locked);
    expect(queryByLabelText('editor')).toBeNull();
    // An unlocked cell in the same row still edits normally.
    fireEvent.keyDown(cells[1]!, { key: 'Enter' }); // r1 / qty
    expect(queryByLabelText('editor')).toBeTruthy();
  });

  it('mounts at most one editor at a time', () => {
    const { getAllByRole, queryAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
      />,
    );
    const cells = getAllByRole('gridcell');
    fireEvent.click(cells[0]!);
    fireEvent.click(cells[1]!);
    expect(queryAllByRole('textbox')).toHaveLength(1);
  });

  it('opens the editor on Enter (keyboard)', () => {
    const { getAllByRole, queryByLabelText, getByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
      />,
    );
    expect(queryByLabelText('editor')).toBeNull();
    fireEvent.keyDown(getAllByRole('gridcell')[0]!, { key: 'Enter' });
    expect(getByLabelText('editor')).toBeTruthy();
  });

  it('does not activate cells when not editable', () => {
    const { getAllByRole, queryByLabelText } = render(
      <DataGrid<Row> rows={rows()} columns={COLS} getRowId={getRowId} editable={false} renderDisplay={display} renderEditor={editor} />,
    );
    fireEvent.click(getAllByRole('gridcell')[0]!);
    expect(queryByLabelText('editor')).toBeNull();
  });

  it('fires onAddRow and onRemoveRow (by row id)', () => {
    const onAddRow = vi.fn();
    const onRemoveRow = vi.fn();
    const { getByText, getAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        canAddRow
        canRemoveRow
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
        onAddRow={onAddRow}
        onRemoveRow={onRemoveRow}
        addRowLabel="Add"
        removeRowLabel="Remove"
      />,
    );
    fireEvent.click(getByText('Add'));
    expect(onAddRow).toHaveBeenCalledTimes(1);
    const removeButtons = getAllByRole('button').filter((b) => b.getAttribute('aria-label') === 'Remove');
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]!);
    expect(onRemoveRow).toHaveBeenCalledWith('r1');
  });

  it('starts editing and seeds the typed character (edit-on-type)', () => {
    const onCellChange = vi.fn();
    const { getAllByRole, getByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    fireEvent.keyDown(getAllByRole('gridcell')[0]!, { key: 'x' });
    expect(onCellChange).toHaveBeenCalledWith({ rowId: 'r1', fieldname: 'name', value: 'x' });
    expect(getByLabelText('editor')).toBeTruthy();
  });

  it('restores the pre-edit value on Escape', () => {
    const onCellChange = vi.fn();
    const { getAllByRole, getByLabelText, queryByLabelText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    fireEvent.click(getAllByRole('gridcell')[0]!); // edit r1 / name (pre-edit value 'Apple')
    fireEvent.change(getByLabelText('editor'), { target: { value: 'Banana' } });
    fireEvent.keyDown(getByLabelText('editor'), { key: 'Escape' });
    expect(onCellChange).toHaveBeenLastCalledWith({ rowId: 'r1', fieldname: 'name', value: 'Apple' });
    expect(queryByLabelText('editor')).toBeNull();
  });

  it('appends a row when navigating down past the last row', () => {
    const onAddRow = vi.fn();
    const { getAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        autoAppendRow
        canAddRow
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
        onAddRow={onAddRow}
      />,
    );
    // last row's first cell = index 2 (2 columns x 2 rows, no action column)
    fireEvent.keyDown(getAllByRole('gridcell')[2]!, { key: 'ArrowDown' });
    expect(onAddRow).toHaveBeenCalledTimes(1);
  });

  it('renders a header tooltip from the column config', () => {
    const cols: DataGridColumn[] = [{ key: 'name', label: 'Name', kind: 'text', tooltip: 'The column name' }];
    const { getAllByRole } = render(
      <DataGrid<Row> rows={rows()} columns={cols} getRowId={getRowId} editable={false} renderDisplay={display} />,
    );
    expect(getAllByRole('columnheader')[0]!.getAttribute('title')).toBe('The column name');
  });

  it('moves the selection to the last column on End', () => {
    const { getAllByRole } = render(
      <DataGrid<Row> rows={rows()} columns={COLS} getRowId={getRowId} editable={false} renderDisplay={display} />,
    );
    const cells = getAllByRole('gridcell');
    cells[0]!.focus();
    fireEvent.keyDown(cells[0]!, { key: 'End' });
    expect(document.activeElement).toBe(cells[1]!); // r1 / qty (last column)
  });

  it('applies a consumer-computed cellClassName', () => {
    const cellClassName = ({ column }: DataGridDisplayArgs<Row>) =>
      column.key === 'qty' ? 'text-error' : undefined;
    const { getAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable={false}
        renderDisplay={display}
        cellClassName={cellClassName}
      />,
    );
    const cells = getAllByRole('gridcell'); // [r1/name, r1/qty, r2/name, r2/qty]
    expect(cells[0]!.className).not.toContain('text-error');
    expect(cells[1]!.className).toContain('text-error');
  });

  it('renders a footer row from the footer map', () => {
    const { getByText } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable={false}
        renderDisplay={display}
        footer={{ qty: 'Sum 7' }}
      />,
    );
    expect(getByText('Sum 7')).toBeTruthy();
  });

  it('applies a fixed column width', () => {
    const cols: DataGridColumn[] = [
      { key: 'name', label: 'Name', kind: 'text', width: 120 },
      { key: 'qty', label: 'Qty', kind: 'number' },
    ];
    const { getAllByRole } = render(
      <DataGrid<Row> rows={rows()} columns={cols} getRowId={getRowId} editable={false} renderDisplay={display} />,
    );
    expect(getAllByRole('row')[0]!.getAttribute('style')).toContain('120px'); // header carries the template
  });

  it('increments a stepper cell via the + button', () => {
    const onCellChange = vi.fn();
    const cols: DataGridColumn[] = [{ key: 'qty', label: 'Qty', kind: 'number', stepper: { min: 0, step: 1 } }];
    const { getAllByLabelText } = render(
      <DataGrid<Row>
        rows={[{ _row_id: 'r1', qty: 2 }]}
        columns={cols}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    fireEvent.click(getAllByLabelText('increment')[0]!);
    expect(onCellChange).toHaveBeenCalledWith({ rowId: 'r1', fieldname: 'qty', value: 3 });
  });

  it('clamps a stepper to its min on decrement', () => {
    const onCellChange = vi.fn();
    const cols: DataGridColumn[] = [{ key: 'qty', label: 'Qty', kind: 'number', stepper: { min: 0, step: 1 } }];
    const { getAllByLabelText } = render(
      <DataGrid<Row>
        rows={[{ _row_id: 'r1', qty: 0 }]}
        columns={cols}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    fireEvent.click(getAllByLabelText('decrement')[0]!);
    expect(onCellChange).toHaveBeenCalledWith({ rowId: 'r1', fieldname: 'qty', value: 0 });
  });

  it('copies the focused row as TSV on copy', () => {
    const { getAllByRole } = render(
      <DataGrid<Row> rows={rows()} columns={COLS} getRowId={getRowId} editable={false} renderDisplay={display} />,
    );
    const cells = getAllByRole('gridcell');
    fireEvent.focus(cells[0]!); // selection at (0,0); act-wrapped so setFocused flushes
    const setData = vi.fn();
    fireEvent.copy(cells[0]!, { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith('text/plain', 'Apple\t2');
  });

  it('fills a cell from the row above on Ctrl+D', () => {
    const onCellChange = vi.fn();
    const { getAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={onCellChange}
      />,
    );
    const cells = getAllByRole('gridcell'); // cells[2] = r2 / name (row 1, col 0)
    fireEvent.keyDown(cells[2]!, { key: 'd', ctrlKey: true });
    expect(onCellChange).toHaveBeenCalledWith({ rowId: 'r2', fieldname: 'name', value: 'Apple' });
  });

  it('fires onDuplicateRow by row id', () => {
    const onDuplicateRow = vi.fn();
    const { getAllByRole } = render(
      <DataGrid<Row>
        rows={rows()}
        columns={COLS}
        getRowId={getRowId}
        editable
        renderDisplay={display}
        renderEditor={editor}
        onCellChange={() => {}}
        onDuplicateRow={onDuplicateRow}
        duplicateRowLabel="Dup"
      />,
    );
    const dupButtons = getAllByRole('button').filter((b) => b.getAttribute('aria-label') === 'Dup');
    expect(dupButtons).toHaveLength(2);
    fireEvent.click(dupButtons[0]!);
    expect(onDuplicateRow).toHaveBeenCalledWith('r1');
  });
});
