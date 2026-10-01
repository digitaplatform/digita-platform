import { ROW_ID_FIELD } from '@digitaplatform/shared';

type Doc = Record<string, unknown>;

const isEmpty = (v: unknown) => v == null || v === '';

/**
 * Transient, client-only per-row marker: the set of `recompute` cells the user
 * has explicitly overridden by typing into them. Stored as `{ [fieldname]: true }`.
 * Written by the editable grid on a direct cell edit, read here to keep a preview
 * from refreshing a value the user authored. Never persisted — stripped before save
 * exactly like the other display-only row keys (see RecordPage.stripRow).
 */
export const RECOMPUTE_OVERRIDES_KEY = '_recompute_overrides';

function isOverridden(row: Doc, field: string): boolean {
  const o = row[RECOMPUTE_OVERRIDES_KEY];
  return !!o && typeof o === 'object' && (o as Record<string, unknown>)[field] === true;
}

function rowsById(rows: Doc[]): Map<string, Doc> {
  const byId = new Map<string, Doc>();
  for (const r of rows) {
    const id = r[ROW_ID_FIELD];
    if (typeof id === 'string') byId.set(id, r);
  }
  return byId;
}

export interface TableMergeSpec {
  /** Server-owned (read-only) cells — always taken from the preview. */
  owned: string[];
  /**
   * Server-derived but user-editable cells — refreshed from the preview whenever
   * the server's value differs, UNLESS the user has explicitly overridden the cell
   * (marked in `RECOMPUTE_OVERRIDES_KEY`), in which case the user's entry wins.
   */
  derived: string[];
  /**
   * Server-resolved editable cells — taken when the current cell is empty, or when it still
   * holds the stored row's value, as the save re-derives such a cell after its Link moved.
   */
  fillable: string[];
}

/**
 * Merge a preview's recomputed child rows back into the form's current rows, matched
 * by `_row_id` (never by index, so a concurrent add/remove/reorder during the preview
 * debounce is safe).
 *
 *   - `owned`    cells are always taken from the server.
 *   - `derived`  cells (editable + server-derived) are refreshed from the server
 *                whenever they differ, so a derived display value follows its inputs
 *                — unless the user overrode the cell (then their entry is kept).
 *   - `fillable` cells are taken when the current cell is empty, or when it still holds
 *                the value of `storedRows` (the saved record's rows), so an entry the
 *                person made is never overwritten.
 *
 * Returns the merged array, or `null` when nothing changed so the caller can skip a
 * redundant write.
 */
export function mergePreviewRows(
  currentRows: Doc[],
  serverRows: Doc[],
  spec: TableMergeSpec,
  storedRows: Doc[] = [],
): Doc[] | null {
  const byId = rowsById(serverRows);
  const storedById = rowsById(storedRows);
  let changed = false;
  const merged = currentRows.map((row) => {
    const sv = byId.get(row[ROW_ID_FIELD] as string);
    if (!sv) return row;
    let next: Doc | null = null;
    for (const k of spec.owned) {
      if (row[k] !== sv[k]) {
        next ??= { ...row };
        next[k] = sv[k];
      }
    }
    for (const k of spec.derived) {
      if (!isOverridden(row, k) && row[k] !== sv[k]) {
        next ??= { ...row };
        next[k] = sv[k];
      }
    }
    const stored = storedById.get(row[ROW_ID_FIELD] as string);
    for (const k of spec.fillable) {
      // Compared as JSON, as the engine compares a cell with its stored value.
      const isStoredValue = stored !== undefined && JSON.stringify(row[k]) === JSON.stringify(stored[k]);
      if (((isEmpty(row[k]) && !isEmpty(sv[k])) || isStoredValue) && row[k] !== sv[k]) {
        next ??= { ...row };
        next[k] = sv[k];
      }
    }
    if (next) changed = true;
    return next ?? row;
  });
  return changed ? merged : null;
}
