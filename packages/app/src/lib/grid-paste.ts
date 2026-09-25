type Doc = Record<string, unknown>;

export interface PasteColumn {
  key: string;
  kind: string;
  editable: boolean;
}

function coerce(v: string, kind: string): unknown {
  if (v === '') return undefined;
  if (kind === 'number' || kind === 'currency') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  if (kind === 'check') return v === 'true' || v === '1' || v.toLowerCase() === 'yes';
  return v;
}

/** Parse pasted clipboard text into a TSV grid (rows by newline, cells by tab). */
export function parseClipboardGrid(text: string): string[][] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => line.split('\t'));
}

/**
 * Apply a pasted TSV grid onto the rows starting at `{row, col}`. Cells map across
 * `columns` (skipping read-only / non-editable columns) and down rows, appending new
 * rows when the paste overflows — bounded by `maxRows` (0 = unbounded) and never past
 * a hard cap. Values are coerced by the target column's kind; an empty cell clears to
 * `undefined` (the empty sentinel). Returns a fresh rows array (one change → one
 * preview).
 */
export function applyPaste(
  currentRows: Doc[],
  columns: PasteColumn[],
  start: { row: number; col: number },
  values: string[][],
  newRow: () => Doc,
  maxRows = 0,
  /** Per-cell veto on top of column `editable` — for per-ROW locks (H15). Rows
   *  appended past the original set are new/unlocked and always writable. */
  canEditCell?: (rowIndex: number, colKey: string) => boolean,
): Doc[] {
  const result = currentRows.map((r) => ({ ...r }));
  const cap = maxRows > 0 ? maxRows : Number.POSITIVE_INFINITY;
  for (let r = 0; r < values.length; r++) {
    const ri = start.row + r;
    if (ri >= cap) break;
    while (ri >= result.length && result.length < cap) result.push(newRow());
    const row = result[ri];
    if (!row) break;
    const cells = values[r]!;
    for (let c = 0; c < cells.length; c++) {
      const col = columns[start.col + c];
      if (!col || !col.editable) continue;
      if (canEditCell && !canEditCell(ri, col.key)) continue;
      row[col.key] = coerce(cells[c]!, col.kind);
    }
  }
  return result;
}
