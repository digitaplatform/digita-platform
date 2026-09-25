import { useId, useRef, useState, type ReactNode } from 'react';
import { LAYOUT_FIELD_TYPES, ROW_ID_FIELD, type FieldDefinition } from '@digitaplatform/shared';
import {
  DataGrid,
  type DataGridApi,
  type DataGridCellKind,
  type DataGridCellPatch,
  type DataGridColumn,
  type DataGridDisplayArgs,
  type DataGridEditArgs,
} from '@digitaplatform/components';
import type { FieldControlProps, FieldControlState } from '@/controls/types';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { useSessionStore } from '@/stores/session';
import { resolveDefaultToken } from '@/lib/default-tokens';
import { sweepRowStates, type FieldStateMap } from '@/lib/evaluate-field';
import { evalFormula } from '@/lib/grid-formula';
import { parseClipboardGrid, applyPaste, type PasteColumn } from '@/lib/grid-paste';
import { cellHasError } from '@/lib/cell-validation';
import { RECOMPUTE_OVERRIDES_KEY } from '@/lib/merge-preview-rows';
import { ControlRenderer } from '@/components/render/ControlRenderer';
import { EntryContextBar } from '@/controls/EntryContextBar';
import { ScanField, type ScanHit } from '@/controls/ScanField';
import { tid } from '@/lib/testid';
import { CellValue } from '@/components/render/cells';
import { RowDetailDialog } from '@/controls/RowDetailDialog';
import { AddViaLinkSearch } from '@/controls/AddViaLinkSearch';
import { LinkEntryInput } from '@/controls/LinkEntryInput';

type Row = Record<string, unknown>;
const ERR = 'rounded-md border border-error bg-error-light px-3 py-2 text-sm text-error';
const EMPTY = new Set<string>();
const ALWAYS = () => true;
const DEFAULT_CELL: FieldControlState = {
  visible: true,
  required: false,
  readOnly: false,
  invalid: false,
  isComputed: false,
  isFrozen: false,
  updating: false,
};

function newRowId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** Map a digita fieldtype onto the grid's closed, generic cell-kind vocabulary. */
const CELL_KIND: Record<string, DataGridCellKind> = {
  Currency: 'currency',
  Int: 'number',
  Float: 'number',
  Percent: 'number',
  Duration: 'number',
  Rating: 'number',
  Date: 'date',
  Datetime: 'date',
  Time: 'date',
  Check: 'check',
  Select: 'select',
  Link: 'link',
};
function cellKindFor(fieldtype: string): DataGridCellKind {
  return CELL_KIND[fieldtype] ?? 'text';
}

/** Parse a FieldDefinition width string ("120", "120px") into pixels. */
function parseGridWidth(w?: string): number | undefined {
  if (!w) return undefined;
  const n = parseInt(w, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Field types whose editor commits and closes on Enter. Excluded: controls that
 * use Enter internally (Link/Select pickers, JSON/Tag/Barcode), so Enter does not
 * prematurely close them.
 */
const ENTER_EXIT_TYPES = new Set([
  'Data',
  'Text',
  'Int',
  'Float',
  'Currency',
  'Percent',
  'Duration',
  'Date',
  'Datetime',
  'Time',
  'Phone',
  'Password',
  'Color',
  'Rating',
]);

/** Stable row id for the grid: the row's `_row_id`, or a per-row fallback. */
const fallbackRowIds = new WeakMap<object, string>();
function stableRowId(row: Row): string {
  const id = row[ROW_ID_FIELD];
  if (typeof id === 'string' && id) return id;
  let f = fallbackRowIds.get(row);
  if (!f) {
    f = newRowId();
    fallbackRowIds.set(row, f);
  }
  return f;
}

/**
 * Child table backed by the generic DataGrid. READ-ONLY (frozen/submitted/
 * perm-stripped) → a virtualized grid (desktop) / cards (mobile) formatted via the
 * shared CellValue. EDITABLE → a virtualized grid with an active-cell editor: a
 * cell shows CellValue until activated, then swaps to a registry control
 * (ControlRenderer) carrying its per-row field-state. A cell edit is applied as a
 * single per-row patch and handed to the form, whose preview pipeline recomputes
 * totals. Add/remove honor cannot_add_rows / cannot_delete_rows / max_rows.
 */
export default function TableControl(props: FieldControlProps) {
  const { field, value, doc, state, entity, onChange } = props;
  const tableId = useId();
  const tField = useI18nStore((s) => s.tField);
  const tc = useChrome();
  const user = useSessionStore((s) => s.user);

  // Detail-dialog + add-via-search state (inline line entry). The search
  // data hooks live in <AddViaLinkSearch>, rendered only when add_via_link is set.
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // The row whose context the EntryContextBar shows: the line most recently
  // added or committed through the entry flow. Declared with the other hooks
  // (before the early returns below — rules-of-hooks).
  const [contextRowId, setContextRowId] = useState<string | null>(null);
  const addField = field.child_fields?.find((c) => c.fieldname === field.add_via_link);
  const apiRef = useRef<DataGridApi | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  if (!field.child_fields || field.child_fields.length === 0) {
    return <div role="alert" className={ERR}>Table “{field.fieldname}” declares no child_fields</div>;
  }
  if (value != null && !Array.isArray(value)) {
    return <div role="alert" className={ERR}>Table “{field.fieldname}” value is not an array</div>;
  }

  const rows = (Array.isArray(value) ? value : []) as Row[];
  const allCols = field.child_fields.filter(
    (f) =>
      !LAYOUT_FIELD_TYPES.includes(f.fieldtype) &&
      f.fieldtype !== 'Table' &&
      // Unconditionally-hidden child fields (e.g. source_row_id) would otherwise
      // show as an empty column header. A depends_on-hidden field stays (it can
      // become visible per row).
      !(f.hidden && !f.depends_on),
  );
  const byName = new Map(allCols.map((c) => [c.fieldname, c] as [string, FieldDefinition]));
  // Grid shows the curated `grid_columns` (in order) when declared, else every column.
  const cols = field.grid_columns
    ? field.grid_columns.map((n) => byName.get(n)).filter((c): c is FieldDefinition => !!c)
    : allCols;
  const docstatus = Number((doc['docstatus'] ?? 0) as number);

  const rowKey = (row: Row, i: number): string => {
    const id = row[ROW_ID_FIELD];
    if (typeof id === 'string' && id) return id;
    if (import.meta.env.DEV) console.warn(`[TableControl] row missing ${ROW_ID_FIELD}`);
    return `row-${i}`;
  };
  const colId = (cf: FieldDefinition) => `${tableId}-col-${cf.fieldname}`;

  const gridColumns: DataGridColumn[] = cols.map((c) => {
    const kind = cellKindFor(c.fieldtype);
    return {
      key: c.fieldname,
      label: tField(entity, c.fieldname, c.label),
      kind,
      align: kind === 'number' || kind === 'currency' ? ('end' as const) : undefined,
      tooltip: c.description,
      width: parseGridWidth(c.width),
      stepper: c.stepper,
      editable: c.display_formula ? false : undefined,
      required: !!(c.required || c.mandatory_depends_on),
    };
  });
  const fieldByName = byName;

  // A display_formula column shows a cosmetic, client-computed value (read-only).
  const formulaRow = (cf: FieldDefinition, row: Row): Row => {
    const r = evalFormula(cf.display_formula!, { doc: row, row });
    return { ...row, [cf.fieldname]: r.error ? undefined : r.value };
  };

  // Cosmetic conditional styling: first matching rule's class for the cell.
  const cellClassName = ({ row, column }: DataGridDisplayArgs<Row>): string | undefined => {
    const rules = fieldByName.get(column.key)?.conditional_style;
    if (!rules) return undefined;
    for (const rule of rules) {
      const r = evalFormula(rule.when, { doc: row, row });
      if (!r.error && r.value) return rule.class;
    }
    return undefined;
  };

  // Footer totals: each maps a column to a parent field rendered via CellValue.
  // The total's format defaults to the TOTALED column's own metadata (fieldtype +
  // currency_field), not a hardcoded money type — an explicit footer override still
  // wins; a Float column totals as Float, a Currency column as Currency (its
  // currency_field carried through). No 'Currency'/'currency' domain assumption.
  const footer = field.footer
    ? Object.fromEntries(
        field.footer.map((f) => {
          const colDef = fieldByName.get(f.column);
          return [
            f.column,
            <CellValue
              key={f.column}
              field={
                {
                  fieldname: f.field,
                  fieldtype: f.fieldtype ?? colDef?.fieldtype ?? 'Float',
                  currency_field: f.currency_field ?? colDef?.currency_field,
                } as FieldDefinition
              }
              row={doc}
              entity={entity}
            />,
          ];
        }),
      )
    : undefined;

  // ── READ-ONLY display ─────────────────────────────────────────────
  if (state.readOnly) {
    if (rows.length === 0) return <span className="text-sm text-textMuted">{tc('ui.table.empty')}</span>;

    const renderReadOnlyCell = ({ row, column }: DataGridDisplayArgs<Row>): ReactNode => {
      const cf = fieldByName.get(column.key);
      if (!cf) return null;
      return <CellValue field={cf} row={cf.display_formula ? formulaRow(cf, row) : row} entity={entity} />;
    };

    return (
      <>
        <DataGrid<Row>
          className="hidden md:block"
          rows={rows}
          columns={gridColumns}
          getRowId={stableRowId}
          editable={false}
          renderDisplay={renderReadOnlyCell}
          cellClassName={cellClassName}
          footer={footer}
          aria-label={tField(entity, field.fieldname, field.label)}
        />
        <ul className="space-y-2 md:hidden">
          {rows.map((row, i) => (
            <li key={rowKey(row, i)} className="rounded-card border border-border p-2">
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                {cols.map((c) => (
                  <div key={c.fieldname} className="truncate">
                    <dt className="text-textMuted">{tField(entity, c.fieldname, c.label)}</dt>
                    <dd className="text-textMain">
                      <CellValue field={c} row={row} entity={entity} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </>
    );
  }

  // ── EDITABLE ──────────────────────────────────────────────────────
  // Per-row field-state sweep, memoized per row id for this render. Only rows the
  // grid actually renders (its visible window) get swept.
  const sweepCache = new Map<string, FieldStateMap>();
  const rowState = (row: Row): FieldStateMap => {
    const id = stableRowId(row);
    let s = sweepCache.get(id);
    if (!s) {
      s = sweepRowStates(allCols, row, {
        computedSet: EMPTY,
        frozenSet: EMPTY,
        docstatus,
        // Child rows: the submit lock is enforced grid-level (the parent Table field
        // goes readOnly on submit → the read-only grid short-circuits), so the row
        // sweep itself needs no submittable flag.
        isSubmittable: false,
        allowOnSubmitSet: EMPTY,
        isNew: false,
        canWriteLevel: ALWAYS,
        user: (user as unknown as Row) ?? {},
      });
      sweepCache.set(id, s);
    }
    return s;
  };

  // Per-cell editability (H15): the DataGrid gates EVERY write path (typed
  // input, Enter/F2, stepper, Ctrl+D fill-down) on this, and paste re-uses it
  // below — so a row-specific read-only / hidden cell can never be mutated
  // before its editor (which also vetoes) has mounted.
  const cellEditableFor = (row: Row | undefined, fieldname: string): boolean => {
    if (!row) return true; // appended new row → writable
    const st = rowState(row)[fieldname];
    return !(st?.readOnly || st?.visible === false);
  };
  const canEditCell = (rowId: string, fieldname: string): boolean =>
    cellEditableFor(
      rows.find((r) => stableRowId(r) === rowId),
      fieldname,
    );

  const applyPatch = ({ rowId, fieldname, value: v }: DataGridCellPatch) =>
    onChange(
      rows.map((r) => {
        if (stableRowId(r) !== rowId) return r;
        const next: Row = { ...r, [fieldname]: v };
        // A direct edit of a server-derived (`recompute`) cell is an explicit user
        // override: mark it so the compute-preview stops refreshing that cell for
        // this row (transient marker, stripped before save — see mergePreviewRows).
        if (fieldByName.get(fieldname)?.recompute) {
          next[RECOMPUTE_OVERRIDES_KEY] = {
            ...(r[RECOMPUTE_OVERRIDES_KEY] as Record<string, boolean> | undefined),
            [fieldname]: true,
          };
        }
        return next;
      }),
    );
  const makeRow = (): Row => {
    const seed: Row = { [ROW_ID_FIELD]: newRowId() };
    // Expand magic-token defaults (__today__/__now__/__user__/__username__) so the
    // row carries the real value, not the literal token (H-P5).
    for (const cf of cols)
      if (cf.default !== undefined) seed[cf.fieldname] = resolveDefaultToken(cf.default, user);
    return seed;
  };
  const addRow = () => onChange([...rows, makeRow()]);
  const removeRowById = (rowId: string) => onChange(rows.filter((r) => stableRowId(r) !== rowId));
  const duplicateRow = (rowId: string) => {
    const idx = rows.findIndex((r) => stableRowId(r) === rowId);
    if (idx < 0) return;
    const dup: Row = { ...rows[idx]!, [ROW_ID_FIELD]: newRowId() };
    onChange([...rows.slice(0, idx + 1), dup, ...rows.slice(idx + 1)]);
  };

  // ── Detail-dialog / add-via-search (inline line entry) ────
  // Nordstern F14 — presentation override: 'cards' forces the detail-dialog
  // presentation, 'grid' forces the inline grid ('auto' keeps today's rule).
  const presentation = field.presentation ?? 'auto';
  const detailMode = presentation === 'cards' || (presentation !== 'grid' && !!field.row_detail_dialog);
  const addViaLink = !!addField;
  const detailFieldDefs = (
    field.detail_fields ??
    allCols.filter((c) => !c.read_only && !c.display_formula).map((c) => c.fieldname)
  )
    .map((n) => byName.get(n))
    .filter((c): c is FieldDefinition => !!c);
  const editingRow = editRowId != null ? rows.find((r) => stableRowId(r) === editRowId) : undefined;
  const saveDetail = (updated: Row) =>
    onChange(rows.map((r) => (stableRowId(r) === editRowId ? updated : r)));
  const openAdd = () => {
    setAddOpen(true);
  };
  const addRowFromPick = (id: string) => {
    const seed = makeRow();
    if (addField) seed[addField.fieldname] = id;
    onChange([...rows, seed]);
    setAddOpen(false);
  };

  // ── Inline entry flow (line-entry keyboard sequence) ─────────
  const entryFlow = field.entry_flow;
  const flowNext = (columnKey: string, row: Row): string | null => {
    if (!entryFlow) return null;
    const seq = entryFlow.sequence;
    const rule = entryFlow.rules?.find((r) => {
      if (r.after !== columnKey) return false;
      const res = evalFormula(r.when, { doc: row, row });
      return !res.error && !!res.value;
    });
    if (rule) return rule.goto;
    const i = seq.indexOf(columnKey);
    return i >= 0 && i < seq.length - 1 ? (seq[i + 1] ?? null) : null;
  };
  const onCellCommit = (rowId: string, columnKey: string) => {
    if (!entryFlow) return;
    setContextRowId(rowId);
    const row = rows.find((r) => stableRowId(r) === rowId);
    if (!row) return;
    const next = flowNext(columnKey, row);
    // End of the sequence → back to the link entry field for the next line.
    if (next) apiRef.current?.editCell(rowId, next);
    else linkInputRef.current?.focus();
  };
  const addLinkRow = (id: string, display?: string) => {
    if (!addField || !entryFlow) return;
    const seed = makeRow();
    seed[addField.fieldname] = id;
    // Child rows don't get the top-level doc's `_link_titles` resolution, so
    // seed it here from the search-picker's already-fetched display text —
    // otherwise the grid's Link cell falls back to the raw ObjectId.
    if (display) {
      seed['_link_titles'] = { ...(seed['_link_titles'] as object), [addField.fieldname]: display };
    }
    if (entryFlow.defaults) {
      for (const [k, v] of Object.entries(entryFlow.defaults)) {
        if (seed[k] == null) seed[k] = v;
      }
    }
    onChange([...rows, seed]);
    setContextRowId(stableRowId(seed));
    apiRef.current?.editCell(stableRowId(seed), entryFlow.sequence[0]!);
  };

  // ── Scan mode (scan_entry) ─────────────────────────────────────────
  // A scan books a complete line without entering the field-by-field flow —
  // that is what makes it fast. Entirely config-driven from `field.scan_entry`
  // (see @digitaplatform/shared): the control names no field itself. A repeat scan
  // whose `match_on` fields equal an existing row's increments that row's
  // `quantity_field` (supermarket semantics) instead of duplicating it. Any
  // part of `scan_entry` left undeclared degrades to a plain add — never a
  // crash — so an app can opt in incrementally.
  const handleScan = (hit: ScanHit, multiplier: number): 'merged' | 'added' => {
    const cfg = field.scan_entry;
    const matchOn = cfg?.match_on;
    const quantityField = cfg?.quantity_field;
    const fieldMap = cfg?.field_map ?? {};
    // The row-field values the hit carries: the link itself (via
    // `add_via_link`) plus whatever `field_map` maps from `hit.fields`.
    const mapped: Row = {};
    if (addField) mapped[addField.fieldname] = hit.link;
    for (const [hitKey, rowField] of Object.entries(fieldMap)) mapped[rowField] = hit.fields[hitKey];

    const existing =
      matchOn && matchOn.length > 0 && quantityField
        ? rows.find((r) => matchOn.every((f) => r[f] === mapped[f]))
        : undefined;
    if (existing && quantityField) {
      const updated: Row = { ...existing, [quantityField]: Number(existing[quantityField] ?? 0) + multiplier };
      for (const rowField of Object.values(fieldMap)) {
        if (updated[rowField] == null && mapped[rowField] != null) updated[rowField] = mapped[rowField];
      }
      onChange(rows.map((r) => (r === existing ? updated : r)));
      setContextRowId(stableRowId(updated));
      return 'merged';
    }

    const seed = makeRow();
    if (addField) seed[addField.fieldname] = hit.link;
    // `field_map` values are authoritative on add: the scan resolved these
    // from a real hit, so they must win even when the target field also
    // carries a static `default` (which `makeRow()` already pre-populated
    // above) — otherwise the default silently survives and the scanned
    // value is discarded. Matches the merge branch above, which likewise
    // treats a hit's mapped fields as ground truth.
    for (const [hitKey, rowField] of Object.entries(fieldMap)) seed[rowField] = hit.fields[hitKey];
    if (quantityField) seed[quantityField] = multiplier;
    if (entryFlow?.defaults) {
      for (const [k, v] of Object.entries(entryFlow.defaults)) {
        if (seed[k] == null) seed[k] = v;
      }
    }
    onChange([...rows, seed]);
    setContextRowId(stableRowId(seed));
    return 'added';
  };
  const scanSearchFallback = (code: string) => {
    const el = linkInputRef.current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, code);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  const onPasteCells = ({ row, col, text }: { row: number; col: number; text: string }) => {
    const pasteCols: PasteColumn[] = cols.map((c) => ({
      key: c.fieldname,
      kind: cellKindFor(c.fieldtype),
      editable: !c.read_only && !c.display_formula,
    }));
    const max = field.cannot_add_rows ? rows.length : (field.max_rows ?? 0);
    // H15: paste must skip per-row-locked cells too (column `editable` alone
    // isn't enough); rows[i] undefined = a newly-appended row → writable.
    const canPasteCell = (rowIndex: number, colKey: string): boolean =>
      cellEditableFor(rows[rowIndex], colKey);
    onChange(
      applyPaste(rows, pasteCols, { row, col }, parseClipboardGrid(text), makeRow, max, canPasteCell),
    );
  };

  const renderEditableCell = ({ row, column }: DataGridDisplayArgs<Row>): ReactNode => {
    if (rowState(row)[column.key]?.visible === false) return null;
    const cf = fieldByName.get(column.key);
    if (!cf) return null;
    return <CellValue field={cf} row={cf.display_formula ? formulaRow(cf, row) : row} entity={entity} />;
  };
  const renderEditor = ({
    row,
    column,
    rowId,
    value: cellValue,
    onChange: emit,
    done,
    cancel,
  }: DataGridEditArgs<Row>): ReactNode => {
    const cf = fieldByName.get(column.key);
    if (!cf) return null;
    const st = rowState(row)[column.key] ?? DEFAULT_CELL;
    if (st.visible === false) return null;
    // A row-specific read-only cell shows its formatted value, not an editor.
    if (st.readOnly) return <CellValue field={cf} row={row} entity={entity} />;
    const invalid = cellHasError(cf, st.required, cellValue);
    return (
      <div
        className="w-full"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // A control that consumed Escape (Combobox/Popover closing its own
            // popup) must NOT also cancel the cell edit — that silently
            // reverted a just-picked Link value.
            if (e.defaultPrevented) return;
            e.stopPropagation();
            cancel();
          } else if (
            (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) &&
            ENTER_EXIT_TYPES.has(cf.fieldtype)
          ) {
            // preventDefault for BOTH: Enter would otherwise fire the record
            // form's implicit submit (confirm-save mid-line), Tab would move
            // focus out from under the entry flow.
            e.preventDefault();
            e.stopPropagation();
            if (!invalid) done(); // bounce-back: stay in the cell while it is invalid
          }
        }}
      >
        <ControlRenderer
          field={cf}
          value={cellValue}
          doc={row}
          row={row}
          parentDoc={doc}
          entity={entity}
          state={invalid ? { ...st, invalid: true } : st}
          onChange={emit}
          onCommit={done}
          controlId={`${tableId}-${rowId}-${cf.fieldname}`}
          labelId={colId(cf)}
        />
      </div>
    );
  };

  // Inline line entry: all columns inline, no add button — the link entry
  // field below the grid appends a line and focus flows through the editable
  // cells per `entry_flow.sequence` / `entry_flow.rules` (conditionally
  // branching per row), landing back on the entry field after the last column.
  if (entryFlow) {
    return (
      <>
        <DataGrid<Row>
          rows={rows}
          columns={gridColumns}
          getRowId={stableRowId}
          editable
          canAddRow={false}
          canRemoveRow={!field.cannot_delete_rows}
          autoAppendRow={false}
          maxRows={field.max_rows ?? 0}
          renderDisplay={renderEditableCell}
          renderEditor={renderEditor}
          canEditCell={canEditCell}
          cellClassName={cellClassName}
          footer={footer}
          onCellChange={applyPatch}
          onRemoveRow={removeRowById}
          apiRef={apiRef}
          onCellCommit={onCellCommit}
          entrySlot={
            addField ? (
              <LinkEntryInput
                linkField={addField}
                onPick={addLinkRow}
                inputRef={linkInputRef}
                testId={tid.entry(entity, field.fieldname)}
              />
            ) : undefined
          }
          removeRowLabel={tc('ui.table.removeRow')}
          aria-label={tField(entity, field.fieldname, field.label)}
        />
        {field.entry_context_view && field.entry_context_params && contextRowId && (
          <EntryContextBar
            view={field.entry_context_view}
            paramsMap={field.entry_context_params}
            row={(rows.find((r) => stableRowId(r) === contextRowId) ?? {}) as Row}
            doc={doc}
          />
        )}
        {addField && field.scan_entry?.resolve && (
          <ScanField
            resolve={field.scan_entry.resolve}
            onScan={handleScan}
            onSearchFallback={scanSearchFallback}
            testId={tid.scan(entity, field.fieldname)['data-testid']}
          />
        )}
      </>
    );
  }

  // Line-entry style: display-only cells (no inline editing → no dropdown reflow),
  // edit a row in a modal, add rows only by picking via the link search.
  if (detailMode) {
    return (
      <>
        <DataGrid<Row>
          rows={rows}
          columns={gridColumns}
          getRowId={stableRowId}
          editable
          canAddRow={!field.cannot_add_rows}
          canRemoveRow={!field.cannot_delete_rows}
          autoAppendRow={false}
          maxRows={field.max_rows ?? 0}
          renderDisplay={renderEditableCell}
          cellClassName={cellClassName}
          footer={footer}
          onAddRow={addViaLink ? openAdd : addRow}
          onRemoveRow={removeRowById}
          onEditRow={setEditRowId}
          addRowLabel={addViaLink ? tc('ui.table.addViaLink') : tc('ui.table.addRow')}
          removeRowLabel={tc('ui.table.removeRow')}
          editRowLabel={tc('ui.table.editRow')}
          aria-label={tField(entity, field.fieldname, field.label)}
        />
        {editingRow && (
          <RowDetailDialog
            open={editRowId !== null}
            onClose={() => setEditRowId(null)}
            title={tField(entity, field.fieldname, field.label)}
            fields={detailFieldDefs}
            stateMap={rowState(editingRow)}
            row={editingRow}
            entity={entity}
            parentDoc={doc}
            onSave={saveDetail}
          />
        )}
        {addViaLink && addField && (
          <AddViaLinkSearch
            open={addOpen}
            onClose={() => setAddOpen(false)}
            linkField={addField}
            onPick={addRowFromPick}
          />
        )}
      </>
    );
  }

  return (
    <DataGrid<Row>
      rows={rows}
      columns={gridColumns}
      getRowId={stableRowId}
      editable
      canAddRow={!field.cannot_add_rows}
      canRemoveRow={!field.cannot_delete_rows}
      autoAppendRow={!field.cannot_add_rows}
      maxRows={field.max_rows ?? 0}
      renderDisplay={renderEditableCell}
      renderEditor={renderEditor}
      canEditCell={canEditCell}
      cellClassName={cellClassName}
      footer={footer}
      onPasteCells={onPasteCells}
      onCellChange={applyPatch}
      onAddRow={addRow}
      onRemoveRow={removeRowById}
      onDuplicateRow={duplicateRow}
      addRowLabel={tc('ui.table.addRow')}
      removeRowLabel={tc('ui.table.removeRow')}
      duplicateRowLabel={tc('ui.table.duplicateRow')}
      aria-label={tField(entity, field.fieldname, field.label)}
    />
  );
}
