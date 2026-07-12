import { useMemo, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Inbox, Plus } from 'lucide-react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES, NUMERIC_FIELD_TYPES } from '@digitaplatform/shared';
import { Button, cn, tableSkin } from '@digitaplatform/components';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { resolveWorkflowField } from '@/lib/workflow-field';
import { parseSort } from '@/lib/sort';
import { tid } from '@/lib/testid';
import { EmptyState } from '@/components/status';
import { CellValue, StatusBadge } from './cells';

type Row = Record<string, unknown>;

interface ColumnMeta {
  sortable: boolean;
  fieldname?: string;
  /** Numeric fieldtype → right-align the header + cell (see NUMERIC_FIELD_TYPES). */
  numeric?: boolean;
}

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

/**
 * Pure presentation list (no toolbar — the ListPage renders <ListToolbar> above
 * it). Built on @tanstack/react-table headless with manualSorting/manualPagination
 * forced — a future contributor enabling client-side sort would silently sort just
 * one page. Desktop = table, phone = cards (same cells). Columns derive from
 * `visibleColumns` when given, else in_list_view (fallback primary: title/_id).
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
  onRowClick,
  onCreate,
  onSort,
  onPageChange,
  rowActions,
}: ListRendererProps) {
  const tField = useI18nStore((s) => s.tField);
  const tc = useChrome();

  const primaryKey = meta.title_field || '_id';
  const dataFields = useMemo(
    () => resolveColumns(meta, visibleColumns).filter((f) => f.fieldname !== primaryKey),
    [meta, visibleColumns, primaryKey],
  );

  const sortSegs = parseSort(orderBy);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const defs: ColumnDef<Row>[] = [];
    // The workflow-state field (declared `workflow_field`, else `status` when the
    // entity has a state machine; null when it has no workflow at all). When it is
    // ALSO a visible data column we render THAT column as a StatusBadge in place —
    // otherwise the value would show twice: plain text here + the appended __status
    // badge below (BUG-1).
    const wf = resolveWorkflowField(meta);
    const wfInColumns = wf != null && dataFields.some((f) => f.fieldname === wf);
    defs.push({
      id: '__primary',
      header: () => tField(entity, primaryKey, meta.title_field ? undefined : 'ID'),
      cell: ({ row }) => {
        const r = row.original;
        const label = (primaryKey !== '_id' && r[primaryKey] ? String(r[primaryKey]) : String(r['_id'] ?? '—'));
        return (
          <button
            type="button"
            {...tid.row(entity, String(r['_id']))}
            onClick={() => onRowClick(String(r['_id']))}
            className="font-medium text-primary-600 hover:underline"
          >
            {label || '—'}
          </button>
        );
      },
      meta: { sortable: primaryKey !== '_id', fieldname: primaryKey } satisfies ColumnMeta,
    });
    for (const f of dataFields) {
      const isWorkflow = f.fieldname === wf;
      const numeric = NUMERIC_FIELD_TYPES.includes(f.fieldtype);
      defs.push({
        id: f.fieldname,
        accessorKey: f.fieldname,
        header: () => tField(entity, f.fieldname, f.label),
        // Workflow field renders as the same StatusBadge used by the appended column,
        // keeping the field's own label + its ColumnChooser position (BUG-1).
        cell: isWorkflow
          ? ({ row }) => <StatusBadge meta={meta} row={row.original} />
          : ({ row }) => <CellValue field={f} row={row.original} entity={entity} />,
        meta: { sortable: true, fieldname: f.fieldname, numeric } satisfies ColumnMeta,
      });
    }
    // Only append the synthetic status column when the workflow field is NOT already
    // a visible column (else it's rendered in place above → no duplicate).
    if (!wfInColumns && meta.states && meta.states.length > 0) {
      defs.push({
        id: '__status',
        header: () => tc('ui.list.status'),
        cell: ({ row }) => <StatusBadge meta={meta} row={row.original} />,
        meta: { sortable: false } satisfies ColumnMeta,
      });
    }
    if (rowActions) {
      defs.push({
        id: '__actions',
        header: () => null,
        cell: ({ row }) => <div className="flex justify-end">{rowActions(row.original)}</div>,
        meta: { sortable: false } satisfies ColumnMeta,
      });
    }
    return defs;
  }, [meta, entity, primaryKey, dataFields, tField, tc, onRowClick, rowActions]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: totalPages,
  });

  // Chevron per sorted column; a 1-based index too when more than one level is active.
  const sortIndicator = (fieldname?: string) => {
    if (!fieldname) return null;
    const i = sortSegs.findIndex((s) => s.field === fieldname);
    if (i === -1) return null;
    const desc = sortSegs[i]!.dir === 'desc';
    return (
      <span className="inline-flex items-center" aria-label={desc ? 'desc' : 'asc'}>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={cn('h-3 w-3 transition-transform duration-base', desc && 'rotate-180')}
        >
          <path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {sortSegs.length > 1 ? <span className="text-micro">{i + 1}</span> : null}
      </span>
    );
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
      {/* Desktop table. C4: cap the height so this wrapper becomes the vertical
          scroll container — that is what lets the <thead> pin via position:sticky.
          (An overflow-x-only wrapper captures sticky but never scrolls vertically,
          so the header would not pin; the kit DataGrid uses the same bounded-height
          idiom.) */}
      <div data-ui="table" className={cn('hidden max-h-[70vh] overflow-auto md:block', tableSkin.frame)}>
        <table {...tid.component('list-table', entity)} className="w-full text-sm">
          {/* Sticky within the scroll container above; tableSkin.header is opaque
              (bg-subtle) so body rows layer cleanly beneath it while scrolling. */}
          <thead data-ui="table-header" className={cn('sticky top-0 z-10 text-left', tableSkin.header)}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const cm = h.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <th
                      key={h.id}
                      {...(cm?.fieldname ? tid.col(cm.fieldname) : {})}
                      className={cn('px-4 py-[var(--density-gap)]', tableSkin.headerCell, cm?.numeric && 'text-right')}
                    >
                      {cm?.sortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded transition-colors duration-base ease-smooth hover:text-textMain focus-visible:shadow-focus focus-visible:outline-none"
                          title={tc('ui.list.sortHint')}
                          onClick={(e) => onSort(cm.fieldname!, e.shiftKey)}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sortIndicator(cm.fieldname)}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className={isFetching ? 'opacity-60' : ''}>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={String(row.original['_id'])}
                data-ui="table-row"
                className={cn('cursor-pointer last:border-b-0', tableSkin.row)}
              >
                {row.getVisibleCells().map((cell) => {
                  const cm = cell.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <td
                      key={cell.id}
                      className={cn('px-4 py-[var(--density-gap)] text-textMain', cm?.numeric && 'text-right')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul data-ui="list-group" className={'space-y-3 md:hidden ' + (isFetching ? 'opacity-60' : '')}>
        {rows.map((r) => (
          <li key={String(r['_id'])}>
            <button
              type="button"
              data-ui="list-row"
              onClick={() => onRowClick(String(r['_id']))}
              className="block w-full rounded-card border border-border bg-surface p-[var(--density-pad)] text-left shadow-xs transition duration-base ease-smooth active:scale-[0.99]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-primary-600">
                  {primaryKey !== '_id' && r[primaryKey] ? String(r[primaryKey]) : String(r['_id'])}
                </span>
                {meta.states && meta.states.length > 0 && <StatusBadge meta={meta} row={r} />}
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
            </button>
          </li>
        ))}
      </ul>

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
