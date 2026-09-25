import type { FieldDefinition } from '@digitaplatform/shared';

/**
 * The single contract every field-control Unit speaks. Computed ONCE per render
 * at the Form/Page level — Units never call the expression evaluator, never
 * derive their own read-only/required, and reach up only through `onChange`.
 */
export interface FieldControlState {
  visible: boolean;
  /** mandatory_depends_on (fail-closed) ?? field.required. */
  required: boolean;
  /** Most-restrictive wins: static read_only OR read_only_depends_on OR computed
   *  OR frozen-after-submit OR set_only_once-on-existing OR perm-write-strip OR
   *  whole-form-disabled. */
  readOnly: boolean;
  /** Merged in by the Page from react-hook-form errors. */
  invalid: boolean;
  /** Field is an engine `computed` hook target → read-only, value comes from /preview. */
  isComputed: boolean;
  /** snapshot/freeze field AND docstatus >= 1. */
  isFrozen: boolean;
  /** isComputed AND a /preview call is in flight (F6 affordance). Defaults false. */
  updating: boolean;
  /** Set (in dev AND prod) when a depends_on expression failed to parse — rendered
   *  as a visible per-field chip. The loud channel is owned, never console-only. */
  warning?: string;
}

export interface FieldControlProps {
  field: FieldDefinition;
  value: unknown;
  /** Read-only sibling context: the owning record, OR the row inside a Table cell. */
  doc: Record<string, unknown>;
  /** Set ONLY inside a MetaGrid cell: the child row (carries _row_id). doc === row there. */
  row?: Record<string, unknown>;
  /** The owning record when inside a Table cell — for sub-row Link target_path. */
  parentDoc?: Record<string, unknown>;
  /** True ONLY when the control is a DataGrid cell editor (TableControl.renderEditor).
   *  The grid seeds the first typed char as the cell value THEN mounts+focuses the
   *  editor, so a select-on-focus would highlight that seeded char and the next
   *  keystroke would replace it ("123"→"23"). Numeric controls therefore suppress
   *  select-on-focus when inGrid; a record form leaves it undefined so the desired
   *  Nordstern F1 select-on-focus stays. */
  inGrid?: boolean;
  /** Owning doctype (upload context, Link/Select i18n key composition). */
  entity: string;
  /** Precomputed once by evaluateField. */
  state: FieldControlState;
  /** The ONLY upward channel. Controls emit `undefined` for an empty value
   *  (NOT "" or 0) so conditional-required can tell blank from a real 0. */
  onChange: (next: unknown) => void;
  /** Optional: signal that the value is committed (e.g. a Link pick) so a host
   *  grid can advance its entry-flow focus. Most controls ignore it. */
  onCommit?: () => void;
  /** Pre-localized field-error string (zod or engine). Units only DISPLAY it. */
  error?: string;
  // ── a11y slice (computed once at Form level) ──
  controlId: string;
  labelId: string;
  describedById?: string;
  errorId?: string;
}
