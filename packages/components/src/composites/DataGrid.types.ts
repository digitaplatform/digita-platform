import type { ReactNode } from 'react';

/**
 * Closed, generic cell-kind vocabulary owned by DataGrid. A consumer maps its own
 * field types onto these kinds; domain-named kinds are never part of this union.
 */
export type DataGridCellKind =
  | 'text'
  | 'number'
  | 'currency'
  | 'link'
  | 'date'
  | 'check'
  | 'select';

export type DataGridAlign = 'start' | 'center' | 'end';

/**
 * When a cell edit feeds a server-authoritative recompute. `commit` and `blur`
 * fire once the value settles; `change` fires on every keystroke and is reserved
 * for cells that do not drive a recompute.
 */
export type DataGridRecomputeTrigger = 'blur' | 'commit' | 'change';

/** Column descriptor. Domain meaning is supplied only by the values, never the keys. */
export interface DataGridColumn {
  /** Field identity within a row object. */
  key: string;
  /** Already-localized header text (the consumer resolves i18n). */
  label: string;
  /** Generic cell kind; selects the editor/renderer. */
  kind: DataGridCellKind;
  /** Optional header tooltip (already localized). */
  tooltip?: string;
  /** Display-only when false. */
  editable?: boolean;
  /** Render nothing for this column when false. */
  visible?: boolean;
  /** Header marker only. */
  required?: boolean;
  /** Fixed pixel width; columns without a width share the remaining space. */
  width?: number;
  align?: DataGridAlign;
  /** Fields a server recompute owns when this cell changes (server-authoritative). */
  writes?: string[];
  /** When the recompute fires. Defaults to `commit`. */
  trigger?: DataGridRecomputeTrigger;
  /** Show −/+ stepper buttons on this (numeric) cell, clamped to `min`. */
  stepper?: { min?: number; step?: number };
}

/** Imperative grid handle (populated into a consumer-supplied `apiRef`). */
export interface DataGridApi {
  /** Begin editing a cell by row id + column key. If the row is not yet present
   *  (e.g. just appended) the edit starts as soon as it renders. */
  editCell: (rowId: string, columnKey: string) => void;
}

/** A single-cell edit, keyed by stable row id — never a whole-array replacement. */
export interface DataGridCellPatch {
  rowId: string;
  /** Column key of the edited cell. */
  fieldname: string;
  value: unknown;
}

export interface DataGridDisplayArgs<T> {
  row: T;
  column: DataGridColumn;
  rowId: string;
}

export interface DataGridEditArgs<T> {
  row: T;
  column: DataGridColumn;
  rowId: string;
  value: unknown;
  /** Emit the new value; the grid forwards it as a per-row patch via onCellChange. */
  onChange: (value: unknown) => void;
  /** Commit the current value and leave edit mode (return to display). */
  done: () => void;
  /** Discard the in-progress edit, restore the pre-edit value, and leave edit mode. */
  cancel: () => void;
}

export interface DataGridProps<T = Record<string, unknown>> {
  rows: T[];
  columns: DataGridColumn[];
  /** Stable row identity; drives React keys and patch routing. */
  getRowId: (row: T) => string;
  /** Master switch for cell editing affordances. */
  editable?: boolean;
  canAddRow?: boolean;
  canRemoveRow?: boolean;
  /** Append a new row when the selection moves down past the last row. */
  autoAppendRow?: boolean;
  /** 0 or undefined means unbounded. */
  maxRows?: number;
  /** Fixed row height in px (the virtualization estimate). */
  rowHeight?: number;
  /** Extra rows rendered beyond the viewport when virtualized. */
  overscan?: number;
  /** Max height in px of the scrolling body; rows virtualize within it. */
  maxBodyHeight?: number;
  /** Per-cell edit; never emits the whole row array. */
  onCellChange?: (patch: DataGridCellPatch) => void;
  onAddRow?: () => void;
  onRemoveRow?: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  /** When set, an edit action appears per row (e.g. to open a detail dialog). */
  onEditRow?: (rowId: string) => void;
  /** The grid writes its imperative API here (e.g. to drive a custom focus flow). */
  apiRef?: { current: DataGridApi | null };
  /** Called when a cell is committed via Enter — lets the consumer drive a custom
   *  focus flow (e.g. advance to a specific next cell, or append + edit). */
  onCellCommit?: (rowId: string, columnKey: string) => void;
  /** Renders a cell's read-only display; defaults to string coercion of row[key]. */
  renderDisplay?: (args: DataGridDisplayArgs<T>) => ReactNode;
  /** Renders the editor for the active cell; without it the grid stays read-only. */
  renderEditor?: (args: DataGridEditArgs<T>) => ReactNode;
  /**
   * Per-CELL editability, on top of the column-level `editable`. The consumer
   * computes it from its own per-row state (row-level read-only, set-only-once,
   * field-level permission). Returning false blocks ALL write paths for that
   * cell — typed input, Enter/F2, the stepper, Ctrl+D fill-down — before any
   * value reaches `onCellChange` (H15: no mutate-before-veto).
   */
  canEditCell?: (rowId: string, columnKey: string) => boolean;
  /** Optional extra class for a cell (e.g. conditional formatting), computed by the
   *  consumer — the grid only applies it. */
  cellClassName?: (args: DataGridDisplayArgs<T>) => string | undefined;
  /** Optional footer row: content per column key, rendered below the body. */
  footer?: Record<string, ReactNode>;
  /** Nordstern F11 — line-entry slot rendered INSIDE the frame as a ghost row
   *  (below body/footer, above the add-row strip). */
  entrySlot?: ReactNode;
  /** Raw clipboard paste at the selected cell; the consumer parses and applies it. */
  onPasteCells?: (args: { row: number; col: number; text: string }) => void;
  /** Localized "add row" label (consumer-provided). */
  addRowLabel?: string;
  /** Localized "remove row" label (consumer-provided). */
  removeRowLabel?: string;
  /** Localized "duplicate row" label (consumer-provided). */
  duplicateRowLabel?: string;
  /** Localized "edit row" label (consumer-provided). */
  editRowLabel?: string;
  className?: string;
  'aria-label'?: string;
}
