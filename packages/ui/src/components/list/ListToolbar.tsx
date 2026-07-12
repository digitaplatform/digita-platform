import { useEffect, useRef, useState } from 'react';
import { Search, SlidersHorizontal, Columns3, Download, Upload, Repeat, X, Plus, MoreHorizontal } from 'lucide-react';
import type { EntityDefinition } from '@digitaplatform/shared';
import { Button, Input, Badge, Fab, Menu, MenuItem, Tooltip } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useSessionStore } from '@/stores/session';
import { formatNumber } from '@/lib/format';
import { useFocusTrap } from '@/lib/use-focus-trap';
import type { FilterTuple } from '@/lib/filter-from-url';
import type { ListPreferenceDoc, ViewVisibility } from '@/services/listPreference';
import { FilterChip } from './FilterChip';
import { FilterEditor } from './FilterEditor';
import { ColumnChooser } from './ColumnChooser';
import { ViewPicker } from './ViewPicker';

/**
 * The single entry the ListPage renders above ListRenderer. Composes: search
 * input · ViewPicker · a Filter button opening a popover (desktop) / bottom-sheet
 * (mobile) of FilterEditor rows with an AND/OR group toggle · active FilterChips ·
 * a Columns button opening ColumnChooser · the New button.
 *
 * PURE: the ListPage owns ALL state (URL params + useListPreferences) and passes
 * it down; this component only emits via callbacks. The AND list lives in
 * `filters`, the OR list in `orFilters`; the group toggle routes new rows to the
 * active bucket. onFiltersChange emits BOTH buckets so the page writes ?f + ?of
 * atomically.
 */

export interface ListToolbarProps {
  entity: string;
  meta: EntityDefinition;
  /** C4: total matching records — rendered as a muted count beside the title. */
  total?: number;
  search: string;
  filters: FilterTuple[];
  orFilters: FilterTuple[];
  /** Visible columns (ordered). [] = in_list_view default. */
  columns: string[];
  savedViews: ListPreferenceDoc[];
  activeViewId?: string;
  /** The applied view has unsaved edits. */
  modified?: boolean;
  /** Whether the current state can be saved as / into a view. */
  canSaveView?: boolean;
  canCreate: boolean;
  isAdmin?: boolean;
  canEditView: (v: ListPreferenceDoc) => boolean;
  onSearch: (q: string) => void;
  onFiltersChange: (and: FilterTuple[], or: FilterTuple[]) => void;
  onColumnsChange: (cols: string[]) => void;
  onApplyView: (id: string) => void;
  onResetView: () => void;
  onAllRecords: () => void;
  onSaveView: (name: string, visibility: ViewVisibility, roles: string[], users: string[]) => void;
  onUpdateView: (id: string) => void;
  onDeleteView: (id: string) => void;
  onSetDefaultView: (id: string) => void;
  onClearDefaultView: (id: string) => void;
  onSetOrgDefaultView: (id: string) => void;
  onClearOrgDefaultView: (id: string) => void;
  /** Export the current (filtered/sorted) list to CSV. Omitted → no export button. */
  onExport?: () => void;
  /** Round-trip export via the engine endpoint (links as business keys, no system
   *  fields — re-importable). Omitted → no round-trip button. */
  onExportRoundTrip?: () => void;
  /** Open the import wizard. Presence = permission-gated visibility. */
  onImport?: () => void;
  onCreate: () => void;
}

export function ListToolbar(props: ListToolbarProps) {
  const {
    entity,
    meta,
    total,
    search,
    filters,
    orFilters,
    columns,
    savedViews,
    activeViewId,
    modified,
    canSaveView,
    canCreate,
    isAdmin,
    canEditView,
    onSearch,
    onFiltersChange,
    onColumnsChange,
    onApplyView,
    onResetView,
    onAllRecords,
    onSaveView,
    onUpdateView,
    onDeleteView,
    onSetDefaultView,
    onClearDefaultView,
    onSetOrgDefaultView,
    onClearOrgDefaultView,
    onExport,
    onExportRoundTrip,
    onImport,
    onCreate,
  } = props;

  const tc = useChrome();
  const locale = useSessionStore((s) => s.locale);

  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const activeCount = filters.length + orFilters.length;

  // A1: collapse the tertiary data-exchange actions into one overflow menu —
  // only render the trigger when at least one of them is permitted/wired.
  const hasDataMenu = !!(onExport || onExportRoundTrip || onImport);

  // Debounced search (mirrors ListRenderer's idiom so behavior is consistent).
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (draft !== search) onSearch(draft);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  function removeAndAt(i: number): void {
    onFiltersChange(filters.filter((_, idx) => idx !== i), orFilters);
  }
  function removeOrAt(i: number): void {
    onFiltersChange(filters, orFilters.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* C7: use the shared text-h1 scale token (weight + tracking ride along)
            so the list page title matches record/page titles exactly. */}
        <h1 className="text-h1 font-display text-textMain">
          {meta.label_plural ?? meta.label ?? entity}
          {/* C4: locale-formatted total beside the title (muted, non-display weight
              so it reads as a subtitle, not part of the heading). */}
          {total != null && (
            <span className="ml-2 align-middle text-base font-normal text-textMuted">
              · {formatNumber(total, locale?.format_locale)}
            </span>
          )}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder={tc('ui.list.search')}
              className="h-8 w-44 py-1 pl-8"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={tc('ui.list.search')}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((o) => !o)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{tc('ui.filter.button')}</span>
            {activeCount > 0 && <Badge variant="pill" color="info">{activeCount}</Badge>}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={columnsOpen}
            onClick={() => setColumnsOpen((o) => !o)}
            aria-label={tc('ui.column.title')}
          >
            <Columns3 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">{tc('ui.column.title')}</span>
          </Button>

          {/* A1: data-exchange overflow menu. The three tertiary actions
              (Export CSV / Export for re-import / Import) collapse into ONE
              icon trigger + the kit Menu so they stop out-weighting the primary
              toolbar actions. Icon-only trigger ⇒ accessible name via Menu.label
              plus a visual Tooltip. The E2E data-testids ride on the wrapping
              role="none" <div> because MenuItem doesn't forward arbitrary props —
              keep them EXACT (action:export-round-trip / action:import). The
              trigger needs a stable, unlocalized handle of its own (the panel
              only exists while open, and the trigger's only other hook is a
              localized aria-label) — the `action:data-menu` wrapper is that
              handle; `contents` keeps it out of the flex layout. */}
          {hasDataMenu && (
            <div data-testid="action:data-menu" className="contents">
              <Tooltip label={tc('ui.list.dataMenu')}>
                <Menu
                  label={tc('ui.list.dataMenu')}
                  align="end"
                  panelClassName="w-56"
                  /* Mirror <Button variant="secondary"> so the trigger lines up
                     with the other (icon-collapsed) toolbar buttons. */
                  triggerClassName="inline-flex items-center justify-center rounded-btn bg-subtle px-4 py-2.5 text-sm font-medium text-textMain transition duration-base ease-smooth hover:bg-bgHover focus-visible:outline-none focus-visible:shadow-focus"
                  trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                >
                  {(close) => (
                    <>
                      {onExport && (
                        <div role="none" data-testid="action:export-csv">
                          <MenuItem
                            icon={<Download className="h-4 w-4" aria-hidden="true" />}
                            onSelect={() => {
                              close();
                              onExport();
                            }}
                          >
                            {tc('ui.list.export')}
                          </MenuItem>
                        </div>
                      )}
                      {onExportRoundTrip && (
                        <div role="none" data-testid="action:export-round-trip">
                          <MenuItem
                            icon={<Repeat className="h-4 w-4" aria-hidden="true" />}
                            onSelect={() => {
                              close();
                              onExportRoundTrip();
                            }}
                          >
                            {tc('ui.list.exportRoundTrip')}
                          </MenuItem>
                        </div>
                      )}
                      {onImport && (
                        <div role="none" data-testid="action:import">
                          <MenuItem
                            icon={<Upload className="h-4 w-4" aria-hidden="true" />}
                            onSelect={() => {
                              close();
                              onImport();
                            }}
                          >
                            {tc('ui.list.import')}
                          </MenuItem>
                        </div>
                      )}
                    </>
                  )}
                </Menu>
              </Tooltip>
            </div>
          )}

          <ViewPicker
            views={savedViews}
            activeId={activeViewId}
            modified={modified}
            canSave={canSaveView}
            isAdmin={isAdmin}
            canEdit={canEditView}
            onApply={onApplyView}
            onReset={onResetView}
            onAllRecords={onAllRecords}
            onSaveAs={onSaveView}
            onUpdate={onUpdateView}
            onDelete={onDeleteView}
            onSetDefault={onSetDefaultView}
            onClearDefault={onClearDefaultView}
            onSetOrgDefault={onSetOrgDefaultView}
            onClearOrgDefault={onClearOrgDefaultView}
          />

          {canCreate && (
            <>
              {/* Under Material the toolbar button hides (the FAB is the M3 create
                  affordance); everywhere else it stays. `contents` keeps layout
                  identical until the variant rule flips it to display:none. */}
              <span data-ui="create-action" className="contents">
                <Button type="button" size="sm" onClick={onCreate}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {tc('ui.action.new')}
                </Button>
              </span>
              {/* Adaptive M3 FAB — hidden by default, shown only under the Material
                  variant. */}
              <Fab
                adaptive
                label={tc('ui.action.new')}
                icon={<Plus className="h-6 w-6" aria-hidden="true" />}
                onClick={onCreate}
              />
            </>
          )}
        </div>
      </div>

      {/* Active filter chips (always visible, even when the editor is closed). */}
      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((f, i) => (
            <FilterChip key={`and-${i}`} meta={meta} filter={f} onRemove={() => removeAndAt(i)} />
          ))}
          {orFilters.length > 0 && (
            <span className="text-xs font-medium uppercase text-textMuted">{tc('ui.filter.or')}</span>
          )}
          {orFilters.map((f, i) => (
            <FilterChip key={`or-${i}`} meta={meta} filter={f} onRemove={() => removeOrAt(i)} />
          ))}
          <button
            type="button"
            onClick={() => onFiltersChange([], [])}
            className="text-xs text-textMuted underline hover:text-textMain"
          >
            {tc('ui.filter.clearAll')}
          </button>
        </div>
      )}

      {filterOpen && (
        <FilterPanel
          meta={meta}
          filters={filters}
          orFilters={orFilters}
          onChange={onFiltersChange}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {columnsOpen && (
        <SheetOrPopover title={tc('ui.column.title')} onClose={() => setColumnsOpen(false)}>
          <ColumnChooser
            meta={meta}
            visible={columns}
            onSave={(cols) => {
              onColumnsChange(cols);
              setColumnsOpen(false);
            }}
            onCancel={() => setColumnsOpen(false)}
          />
        </SheetOrPopover>
      )}
    </div>
  );
}

/* ── Filter panel: editor rows + AND/OR group toggle + Add condition ────────── */

interface FilterPanelProps {
  meta: EntityDefinition;
  filters: FilterTuple[];
  orFilters: FilterTuple[];
  onChange: (and: FilterTuple[], or: FilterTuple[]) => void;
  onClose: () => void;
}

function FilterPanel({ meta, filters, orFilters, onChange, onClose }: FilterPanelProps) {
  const tc = useChrome();
  // Which bucket newly-added rows go to. MVP: a single global AND/OR switch.
  const [group, setGroup] = useState<'and' | 'or'>(orFilters.length && !filters.length ? 'or' : 'and');

  const rows = group === 'and' ? filters : orFilters;
  const setRows = (next: FilterTuple[]) =>
    group === 'and' ? onChange(next, orFilters) : onChange(filters, next);

  function addRow(): void {
    setRows([...rows, ['', '', ''] as FilterTuple]);
  }
  function updateRow(i: number, next: FilterTuple): void {
    setRows(rows.map((r, idx) => (idx === i ? next : r)));
  }
  function removeRow(i: number): void {
    setRows(rows.filter((_, idx) => idx !== i));
  }

  return (
    <SheetOrPopover title={tc('ui.filter.title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={tc('ui.filter.matchMode')} className="flex items-center gap-2 text-sm">
          <span className="text-textMuted">{tc('ui.filter.match')}</span>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              role="radio"
              aria-checked={group === 'and'}
              onClick={() => setGroup('and')}
              className={
                'px-3 py-1 ' + (group === 'and' ? 'bg-primary-600 text-white' : 'bg-surface text-textMain')
              }
            >
              {tc('ui.filter.all')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={group === 'or'}
              onClick={() => setGroup('or')}
              className={
                'px-3 py-1 ' + (group === 'or' ? 'bg-primary-600 text-white' : 'bg-surface text-textMain')
              }
            >
              {tc('ui.filter.any')}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="py-2 text-sm text-textMuted">{tc('ui.filter.noConditions')}</p>
          )}
          {rows.map((row, i) => (
            <FilterEditor
              key={i}
              meta={meta}
              filter={row}
              onChange={(next) => updateRow(i, next)}
              onRemove={() => removeRow(i)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" className="text-sm" onClick={addRow}>
            + {tc('ui.filter.addCondition')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="text-sm"
              disabled={!filters.length && !orFilters.length}
              onClick={() => onChange([], [])}
            >
              {tc('ui.filter.clearAll')}
            </Button>
            <Button type="button" className="text-sm" onClick={onClose}>
              {tc('ui.action.done')}
            </Button>
          </div>
        </div>
      </div>
    </SheetOrPopover>
  );
}

/* ── Responsive container: bottom-sheet on mobile, popover card on desktop ──── */

interface SheetOrPopoverProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function SheetOrPopover({ title, onClose, children }: SheetOrPopoverProps) {
  const tc = useChrome();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A nested control that consumed Escape (a Select/Combobox closing its own
      // popup calls preventDefault) must NOT also collapse the whole panel and
      // discard its staged draft state.
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Mobile scrim */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          'z-50 rounded-lg border border-border bg-surface shadow-soft ' +
          // Mobile: full-width bottom sheet. Desktop: inline panel within flow.
          'fixed inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-b-none p-4 ' +
          'md:static md:max-h-none md:rounded-b-lg md:p-4'
        }
      >
        <div className="mb-3 flex items-center justify-between md:hidden">
          <h2 className="text-base font-semibold text-textMain">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc('ui.action.close')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-textMuted hover:bg-subtle"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
