import { describe, it, expect } from 'vitest';
import { parseClipboardGrid, applyPaste, type PasteColumn } from '@/lib/grid-paste';

const cols: PasteColumn[] = [
  { key: 'part', kind: 'link', editable: true },
  { key: 'quantity', kind: 'number', editable: true },
  { key: 'amount', kind: 'currency', editable: false },
];
let idc = 0;
const newRow = () => ({ _row_id: `n${idc++}`, part: undefined, quantity: undefined });

describe('parseClipboardGrid', () => {
  it('splits rows by newline and cells by tab', () => {
    expect(parseClipboardGrid('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
  it('handles CRLF and a trailing newline', () => {
    expect(parseClipboardGrid('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('applyPaste', () => {
  it('writes cells across editable columns and coerces by kind', () => {
    const rows = [{ _row_id: 'a', part: undefined, quantity: undefined }];
    const out = applyPaste(rows, cols, { row: 0, col: 0 }, [['P1', '3']], newRow);
    expect(out[0]!.part).toBe('P1');
    expect(out[0]!.quantity).toBe(3);
  });

  it('skips read-only columns', () => {
    const rows = [{ _row_id: 'a', amount: 99 }];
    const out = applyPaste(rows, cols, { row: 0, col: 2 }, [['123']], newRow);
    expect(out[0]!.amount).toBe(99);
  });

  it('appends rows on overflow', () => {
    const rows = [{ _row_id: 'a', part: undefined, quantity: undefined }];
    const out = applyPaste(rows, cols, { row: 0, col: 0 }, [['P1', '1'], ['P2', '2'], ['P3', '3']], newRow);
    expect(out).toHaveLength(3);
    expect(out[2]!.part).toBe('P3');
  });

  it('respects maxRows when appending', () => {
    const rows = [{ _row_id: 'a', part: undefined, quantity: undefined }];
    const out = applyPaste(rows, cols, { row: 0, col: 0 }, [['P1', '1'], ['P2', '2'], ['P3', '3']], newRow, 2);
    expect(out).toHaveLength(2);
  });

  it('clears a cell to undefined for an empty pasted value', () => {
    const rows = [{ _row_id: 'a', part: 'X', quantity: 5 }];
    const out = applyPaste(rows, cols, { row: 0, col: 0 }, [['', '']], newRow);
    expect(out[0]!.part).toBeUndefined();
    expect(out[0]!.quantity).toBeUndefined();
  });

  it('skips per-row-locked cells via canEditCell but writes appended rows (H15)', () => {
    const rows = [
      { _row_id: 'a', part: 'keep', quantity: 1 }, // row 0: part locked
      { _row_id: 'b', part: undefined, quantity: undefined }, // row 1: editable
    ];
    // Lock only row 0's `part`; everything else (incl. appended rows) is editable.
    const canEditCell = (rowIndex: number, key: string) => !(rowIndex === 0 && key === 'part');
    const out = applyPaste(
      rows,
      cols,
      { row: 0, col: 0 },
      [['X1', '10'], ['X2', '20'], ['X3', '30']],
      newRow,
      0,
      canEditCell,
    );
    expect(out[0]!.part).toBe('keep'); // locked cell untouched
    expect(out[0]!.quantity).toBe(10); // non-locked cell in the same row written
    expect(out[1]!.part).toBe('X2'); // editable row written
    expect(out[2]!.part).toBe('X3'); // appended row written (rows[2] undefined → allowed)
  });
});
