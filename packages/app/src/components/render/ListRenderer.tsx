import { useMemo, type ReactNode } from 'react';
import { Inbox, Plus } from 'lucide-react';
import type { EntityDefinition, FieldDefinition, FieldType } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES, NUMERIC_FIELD_TYPES } from '@digitaplatform/shared';
import {
  Badge,
  Button,
  CardList,
  DataGrid,
  cn,
  type DataGridCellKind,
  type DataGridColumn,
  type DataGridSort,
} from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { resolveWorkflowField } from '@/lib/workflow-field';
import { parseSort } from '@/lib/sort';
import { tid } from '@/lib/testid';
import { useViewportHeight } from '@/hooks/useViewportHeight';
import { EmptyState } from '@/components/status';
import { CellValue, RecordImage, workflowBadge } from './cells';
import { useAmountColumnWidth } from '@/lib/amount-width';

type Row = Record<string, unknown>;

/** The grid's own columns, beside the entity's fields. */
const STATUS_COLUMN = '__status';
const ACTIONS_COLUMN = '__actions';

/** Share of the viewport the desktop grid may take before it scrolls inside its frame,
 *  which is what lets its header pin. */
const GRID_VIEWPORT_SHARE = 0.7;

interface ListRendererProps {
  entity: string;
  meta: EntityDefinition;
  rows: Row[];
  orderBy?: string;
  page: number;
  total: number;
  totalPages: number;
  /** Ordered visible columns (ColumnChooser / saved view). Empty/undefined → in_list_view default. */
  visibleColumns?: string[];
  /** Drives the empty-state hint + its New CTA (the toolbar owns the primary New button). */
  canCreate?: boolean;
  isFetching?: boolean;
  /** The record last opened from this list; its row is marked selected. */
  selectedRowId?: string;
  onRowClick: (name: string) => void;
  /** Invoked by the empty-state New CTA (mirrors the toolbar's onCreate). */
  onCreate?: () => void;
  /** `additive` (Shift-click) adds this field as another sort level. */
  onSort: (fieldname: string, additive: boolean) => void;
  onPageChange: (page: number) => void;
  /** Optional trailing per-row actions column (desktop table only) — e.g. a
   *  print button. Omit for no actions column. */
  rowActions?: (row: Row) => ReactNode;
}

/** A field is showable as a column if it carries data (not layout/section, not a
 *  read-only display, not a child table). */
function isColumnField(f: FieldDefinition): boolean {
  return (
    !LAYOUT_FIELD_TYPES.includes(f.fieldtype) &&
    f.fieldtype !== 'ReadOnly' &&
    f.fieldtype !== 'Table'
  );
}

/** Resolve the data columns: an explicit (ordered) override when provided, else
 *  the meta's in_list_view set. Unknown names in the override are dropped loudly. */
function resolveColumns(meta: EntityDefinition, visibleColumns?: string[]): FieldDefinition[] {
  if (visibleColumns && visibleColumns.length) {
    const byName = new Map(meta.fields.map((f) => [f.fieldname, f] as const));
    const out: FieldDefinition[] = [];
    for (const name of visibleColumns) {
      const f = byName.get(name);
      if (f && isColumnField(f)) out.push(f);
      else if (import.meta.env.DEV) console.warn(`[ListRenderer] unknown/!showable column "${name}" — skipped`);
    }
    return out;
  }
  return meta.fields.filter((f) => f.in_list_view === true && isColumnField(f));
}

/** The grid sizes a column by its kind; the fieldtypes fold onto the grid's vocabulary. */
function cellKind(fieldtype: FieldType): DataGridCellKind {
  if (NUMERIC_FIELD_TYPES.includes(fieldtype)) return fieldtype === 'Currency' ? 'currency' : 'number';
  switch (fieldtype) {
    case 'Link':
      return 'link';
    case 'Date':
    case 'Datetime':
      return 'date';
    case 'Check':
      return 'check';
    case 'Select':
      return 'select';
    default:
      return 'text';
  }
}

/**
 * Pure presentation list (no toolbar — the ListPage renders <ListToolbar> above
 * it). Desktop = the kit DataGrid, phone = the kit CardList (same cells); sorting
 * and paging stay with the server, so the grid only reports a header click.
 * Columns derive from `visibleColumns` when given, else in_list_view (fallback
 * primary: title/_id).
 */
export function ListRenderer({
  entity,
  meta,
  rows,
  orderBy,
  page,
  total,
  totalPages,
  visibleColumns,
  canCreate,
  isFetching,
  selectedRowId,
  onRowClick,
  onCreate,
  onSort,
  onPageChange,
  rowActions,
}: ListRendererProps) {
  const tField = useI18nStore((s) => s.tField);
  const tOption = useI18nStore((s) => s.tOption);
  const tc = useChrome();
  const amountWidth = useAmountColumnWidth();

  const primaryKey = meta.title_field || '_id';
  const dataFields = useMemo(
    () => resolveColumns(meta, visibleColumns).filter((f) => f.fieldname !== primaryKey),
    [meta, visibleColumns, primaryKey],
  );
  const fieldByName = useMemo(() => new Map(dataFields.map((f) => [f.fieldname, f] as const)), [dataFields]);

  // The workflow-state field (declared `workflow_field`, else `status` when the
  // entity has a state machine; null when it has no workflow at all). When it is
  // ALSO a visible data column that column renders the status badge in place —
  // otherwise the value would show twice: plain text there + the appended status
  // column.
  const wf = resolveWorkflowField(meta);
  const wfInColumns = wf != null && dataFields.some((f) => f.fieldname === wf);
  const hasStates = !!meta.states && meta.states.length > 0;

  const columns = useMemo<DataGridColumn[]>(() => {
    const defs: DataGridColumn[] = [
      {
        // Keyed by the field itself, so a header click sorts by a name the server knows.
        key: primaryKey,
        label: tField(entity, primaryKey, meta.title_field ? undefined : 'ID'),
        kind: 'link',
        sortable: primaryKey !== '_id',
        tooltip: primaryKey !== '_id' ? tc('ui.list.sortHint') : undefined,
        headerProps: tid.col(primaryKey),
      },
    ];
    for (const f of dataFields) {
      defs.push({
        key: f.fieldname,
        label: tField(entity, f.fieldname, f.label),
        kind: cellKind(f.fieldtype),
        sortable: true,
        tooltip: tc('ui.list.sortHint'),
        align: NUMERIC_FIELD_TYPES.includes(f.fieldtype) ? 'end' : 'start',
        width: amountWidth(f, rows),
        headerProps: tid.col(f.fieldname),
      });
    }
    if (!wfInColumns && hasStates) {
      defs.push({ key: STATUS_COLUMN, label: tc('ui.list.status'), kind: 'select' });
    }
    if (rowActions) {
      defs.push({ key: ACTIONS_COLUMN, label: '', kind: 'actions', align: 'end' });
    }
    return defs;
  }, [meta, entity, primaryKey, dataFields, wfInColumns, hasStates, rowActions, tField, tc, amountWidth, rows]);

  const sort = useMemo<DataGridSort[]>(
    () => parseSort(orderBy).map((s) => ({ key: s.field, dir: s.dir })),
    [orderBy],
  );

  const viewportHeight = useViewportHeight();
  const listLabel = meta.label_plural ?? meta.label ?? entity;

  const rowId = (r: Row) => String(r['_id']);
  const primaryLabel = (r: Row) =>
    primaryKey !== '_id' && r[primaryKey] ? String(r[primaryKey]) : String(r['_id'] ?? '—');
  const statusBadge = (r: Row) => {
    const state = workflowBadge(meta, r, tOption);
    return state ? (
      <Badge variant="pill" color={state.color}>
        {state.label}
      </Badge>
    ) : null;
  };

  const renderCell = ({ row, column }: { row: Row; column: DataGridColumn }): ReactNode => {
    switch (column.key) {
      case primaryKey:
        return (
          <span className="flex items-center gap-2">
            <RecordImage meta={meta} row={row} className="h-8 w-8" />
            <button
              type="button"
              {...tid.row(entity, rowId(row))}
              onClick={() => onRowClick(rowId(row))}
              className="font-medium text-primary-600 hover:underline"
            >
              {primaryLabel(row) || '—'}
            </button>
          </span>
        );
      case STATUS_COLUMN:
        return statusBadge(row);
      case ACTIONS_COLUMN:
        return rowActions!(row);
      default:
        return column.key === wf ? (
          statusBadge(row)
        ) : (
          <CellValue field={fieldByName.get(column.key)!} row={row} entity={entity} />
        );
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        testId="list-empty"
        title={tc('ui.list.empty')}
        hint={canCreate ? tc('ui.list.emptyHint') : undefined}
        // Generic "empty collection" chrome glyph (not an app concept).
        icon={<Inbox aria-hidden="true" />}
        action={
          canCreate && onCreate ? (
            <Button type="button" onClick={onCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {tc('ui.action.new')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div {...tid.component('list-table', entity)} className={cn('hidden md:block', isFetching && 'opacity-60')}>
        <DataGrid<Row>
          aria-label={listLabel}
          rows={rows}
          columns={columns}
          getRowId={rowId}
          editable={false}
          sort={sort}
          onSort={onSort}
          selectedRowId={selectedRowId}
          // The operator chose these columns; none may vanish behind a "+n" chip.
          columnOverflow="scroll"
          maxBodyHeight={Math.round(viewportHeight * GRID_VIEWPORT_SHARE)}
          renderDisplay={renderCell}
        />
      </div>

      <CardList<Row>
        aria-label={listLabel}
        className={cn('md:hidden', isFetching && 'opacity-60')}
        rows={rows}
        getRowId={rowId}
        selectedRowId={selectedRowId}
        onRowClick={onRowClick}
        renderCard={(r) => (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <RecordImage meta={meta} row={r} className="h-10 w-10" />
                <span className="font-medium text-primary-600">{primaryLabel(r)}</span>
              </span>
              {hasStates && statusBadge(r)}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-textMuted">
              {dataFields.slice(0, 4).map((f) => (
                <div key={f.fieldname} className="truncate">
                  <dt className="inline text-textMuted">{tField(entity, f.fieldname, f.label)}: </dt>
                  <dd className="inline text-textMain">
                    <CellValue field={f} row={r} entity={entity} />
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      />

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-textMuted">
        <span>
          {tc('ui.list.summary', { total, page, pages: Math.max(totalPages, 1) })}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {tc('ui.list.previous')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {tc('ui.list.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
