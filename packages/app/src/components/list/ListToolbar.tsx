import { useEffect, useId, useRef, useState } from 'react';
import { Search, Columns3, Download, Upload, Repeat, X, Plus, MoreHorizontal } from 'lucide-react';
import type { EntityDefinition, FieldDefinition } from '@digitaplatform/shared';
import {
  Button,
  Chip,
  Combobox,
  Input,
  Fab,
  Menu,
  MenuItem,
  PageHeader,
  Select,
  Tooltip,
  useFocusTrap,
  type SelectOption,
} from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useSearchLink } from '@/hooks/useSearchLink';
import { formatNumber, fromDatetimeInput, toDatetimeInput } from '@/lib/format';
import { isCompleteFilter, type FilterTuple } from '@/lib/filter-from-url';
import {
  chooseFilterInputType,
  operatorArity,
  operatorsForFieldtype,
  standardFilterFields,
  type FilterOp,
} from '@/lib/filter-operators';
import { resolveLinkFilters } from '@/lib/link-filters';
import { resolveOptionSource } from '@/lib/option-sources';
import { optionList } from '@/controls/SelectControl';
import type { ListPreferenceDoc, ViewVisibility } from '@/services/listPreference';
import { FilterChip } from './FilterChip';
import { FilterEditor, MultiValueInput } from './FilterEditor';
import { ColumnChooser } from './ColumnChooser';
import { ViewPicker } from './ViewPicker';

/**
 * The single entry the ListPage renders above ListRenderer. Composes the kit
 * PageHeader (title with the total · search · Columns, data menu, ViewPicker and
 * the New action) and, under it, the quick filters of the fields the entity flags
 * in_standard_filter, then the applied FilterChips with the Filter chip that opens
 * a popover (desktop) / bottom-sheet (mobile) of FilterEditor rows with an AND/OR
 * group toggle.
 *
 * PURE: the ListPage owns ALL applied state (URL params + useListPreferences) and
 * passes it down; this component only emits via callbacks. The AND list lives in
 * `filters`, the OR list in `orFilters`; the group toggle routes new rows to the
 * active bucket. onFiltersChange emits BOTH buckets so the page writes ?f + ?of
 * atomically. Only the filter panel keeps rows of its own: those still missing a
 * field or an operator, which are no filters yet. The search box and a quick
 * filter's input keep the text being typed until the person pauses.
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
  /** Omitted → no search box: the tree display filters through a box of its own. */
  onSearch?: (q: string) => void;
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
      if (draft !== search) onSearch?.(draft);
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

  const title = (
    <>
      {meta.label_plural ?? meta.label ?? entity}
      {/* C4: locale-formatted total beside the title (muted, non-display weight
          so it reads as a subtitle, not part of the heading). */}
      {total != null && (
        <span className="ml-2 align-middle text-base font-normal text-textMuted">
          · {formatNumber(total, locale?.format_locale)}
        </span>
      )}
    </>
  );

  // No wrapper of its own: the header sticks inside its containing block, which must be the
  // element that spans the page (the list page's root), not a box around the toolbar.
  return (
    <>
      {/* Pulled out by the header's own inset so its title lines up with the list. */}
      <PageHeader
        className="-mx-4"
        title={title}
        search={
          onSearch && (
            <Input
              type="search"
              wrapperClassName="md:max-w-xs"
              leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
              placeholder={tc('ui.list.search')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={tc('ui.list.search')}
            />
          )
        }
        actions={
          <>
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
          </>
        }
      />

      <QuickFilters meta={meta} filters={filters} onChange={(and) => onFiltersChange(and, orFilters)} />

      {/* The applied filters, each a removable chip, and the Filter chip that opens
          the editor; `filter-action` is the hook a design draws that chip by. */}
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
        <span data-ui="filter-action" className="contents">
          <Chip
            icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((o) => !o)}
          >
            {tc('ui.filter.button')}
          </Chip>
        </span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onFiltersChange([], [])}
            className="text-xs text-textMuted underline hover:text-textMain"
          >
            {tc('ui.filter.clearAll')}
          </button>
        )}
      </div>

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
    </>
  );
}

/* ── Quick filters: one control for each field flagged in_standard_filter ──── */

interface QuickFiltersProps {
  meta: EntityDefinition;
  filters: FilterTuple[];
  onChange: (and: FilterTuple[]) => void;
}

/** The fields a person filters by most, as the author flagged them, each with a control
 *  above the list. A control holds the AND filter of its field with the operator the panel
 *  picks first for the field; a filter on the field with another operator, or an OR filter,
 *  stays as the panel built it. */
function QuickFilters({ meta, filters, onChange }: QuickFiltersProps) {
  const tc = useChrome();
  const tField = useI18nStore((s) => s.tField);
  const fields = standardFilterFields(meta);
  if (fields.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={tc('ui.filter.title')}
      data-ui="quick-filters"
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end"
    >
      {fields.map((field) => {
        // standardFilterFields keeps only the fields a filter has an operator for.
        const op = operatorsForFieldtype(field.fieldtype)[0]!;
        const appliedFilter = filters.find(([name, o]) => name === field.fieldname && o === op);
        return (
          <QuickFilter
            key={field.fieldname}
            meta={meta}
            field={field}
            op={op}
            label={tField(meta.name, field.fieldname, field.label)}
            value={appliedFilter?.[2]}
            onValue={(value) => {
              const nextFilters = applyQuickFilter(filters, [field.fieldname, op, value]);
              if (nextFilters !== filters) onChange(nextFilters);
            }}
          />
        );
      })}
    </div>
  );
}

interface QuickFilterProps {
  meta: EntityDefinition;
  field: FieldDefinition;
  op: FilterOp;
  label: string;
  /** The value of the applied filter; undefined while the field is not filtered. */
  value: unknown;
  /** An empty value takes the filter away. */
  onValue: (value: unknown) => void;
}

/** One quick filter: the label of its field over the control its field type takes. */
function QuickFilter(props: QuickFilterProps) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:w-44">
      <label htmlFor={id} data-ui="field-label" className="text-xs font-medium text-textMuted">
        {props.label}
      </label>
      <QuickFilterControl id={id} {...props} />
    </div>
  );
}

function QuickFilterControl({ id, meta, field, op, label, value, onValue }: QuickFilterProps & { id: string }) {
  const tc = useChrome();
  const tOption = useI18nStore((s) => s.tOption);
  const arity = operatorArity(op);

  if (arity === 'presence') {
    return (
      <QuickChoice
        id={id}
        label={label}
        value={value === 'set' || value === 'not set' ? value : ''}
        options={[
          { value: 'set', label: tc('ui.filter.set') },
          { value: 'not set', label: tc('ui.filter.notSet') },
        ]}
        onChoose={onValue}
      />
    );
  }

  if (field.fieldtype === 'Check') {
    const isYes = value === 1 || value === true || value === '1';
    const isNo = value === 0 || value === false || value === '0';
    return (
      <QuickChoice
        id={id}
        label={label}
        value={isYes ? '1' : isNo ? '0' : ''}
        options={[
          { value: '1', label: tc('ui.filter.yes') },
          { value: '0', label: tc('ui.filter.no') },
        ]}
        onChoose={(next) => onValue(next === '' ? '' : Number(next))}
      />
    );
  }

  if (field.fieldtype === 'Select') {
    const currentValue = value == null ? '' : String(value);
    // The choices of the Select field itself, a declared option source before its options, and
    // the applied value where they lack it, so the control never hides an applied filter. An
    // empty or repeated choice would collide with '—' or with its twin.
    const declaredChoices = field.options_source
      ? resolveOptionSource(field.options_source)
      : optionList(field.options).map((o) => ({ value: o, label: tOption(meta.name, field.fieldname, o) }));
    const choices: SelectOption[] = [];
    for (const choice of declaredChoices) {
      if (choice.value !== '' && !choices.some((c) => c.value === choice.value)) choices.push(choice);
    }
    if (currentValue && !choices.some((c) => c.value === currentValue)) {
      choices.push({ value: currentValue, label: currentValue });
    }
    return <QuickChoice id={id} label={label} value={currentValue} options={choices} onChoose={onValue} />;
  }

  if (arity === 'multi') {
    return (
      <MultiValueInput
        id={id}
        arr={Array.isArray(value) ? value : []}
        numeric={false}
        ariaLabel={label}
        placeholder={tc('ui.filter.commaSeparated')}
        onValue={onValue}
      />
    );
  }

  if (field.fieldtype === 'Link' && field.target) {
    return <QuickLinkFilter id={id} field={field} target={field.target} label={label} value={value} onValue={onValue} />;
  }

  return <QuickTypedFilter id={id} field={field} label={label} value={value} onValue={onValue} />;
}

/** A choice among a field's values, led by '—', which filters by none of them. */
function QuickChoice({
  id,
  label,
  value,
  options,
  onChoose,
}: {
  id: string;
  label: string;
  value: string;
  options: SelectOption[];
  onChoose: (value: string) => void;
}) {
  const tc = useChrome();
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={onChoose}
      options={[{ value: '', label: '—' }, ...options]}
      searchable={options.length > 10}
      searchPlaceholder={tc('ui.list.search')}
      noResultsLabel={tc('ui.select.noResults')}
    />
  );
}

/** A typed value, applied once the person pauses typing, as the search box applies its text:
 *  a request for every letter would be a list nobody waits for. */
function QuickTypedFilter({
  id,
  field,
  label,
  value,
  onValue,
}: {
  id: string;
  field: FieldDefinition;
  label: string;
  value: unknown;
  onValue: (value: unknown) => void;
}) {
  const inputType = chooseFilterInputType(field.fieldtype);
  const timezone = useSessionStore((s) => s.locale?.timezone);
  // A Datetime is typed on the wall clock of the person's time zone and filters by its UTC
  // instant, the value the form stores; the engine reads a time without a zone as UTC.
  const appliedText = inputType === 'datetime-local' ? toDatetimeInput(value, timezone) : value == null ? '' : String(value);
  const [draft, setDraft] = useState(appliedText);
  useEffect(() => setDraft(appliedText), [appliedText]);
  useEffect(() => {
    if (draft === appliedText) return;
    const typedValue = (): unknown => {
      if (inputType === 'number' && draft !== '') return Number(draft);
      if (inputType === 'datetime-local') return fromDatetimeInput(draft, timezone) ?? '';
      return draft;
    };
    const timer = setTimeout(() => onValue(typedValue()), 300);
    return () => clearTimeout(timer);
    // Only the text being typed restarts the pause: the callback is new on every render of
    // the list, and the applied text catches up with the draft once it is applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return <Input id={id} type={inputType} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

/** A record of the Link's target, searched by what the person types, as the panel's Link
 *  value is. The filter carries the record's id: after a reload the control shows the id,
 *  because a filter carries no title. */
function QuickLinkFilter({
  id,
  field,
  target,
  label,
  value,
  onValue,
}: {
  id: string;
  field: FieldDefinition;
  target: string;
  label: string;
  value: unknown;
  onValue: (value: unknown) => void;
}) {
  const tc = useChrome();
  const [query, setQuery] = useState('');
  const [searchedText, setSearchedText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [pickedRecord, setPickedRecord] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchedText(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useSearchLink({
    entity: target,
    q: searchedText,
    targetPath: field.target_path,
    // A filter has no document, so a `$doc.` token names nothing here and is dropped.
    filters: resolveLinkFilters(field.target_filters, undefined),
    enabled: isOpen,
  });

  const hasValue = value != null && value !== '';
  const shownText = hasValue ? (pickedRecord && pickedRecord.id === value ? pickedRecord.label : String(value)) : '';

  return (
    <Combobox
      id={id}
      value={shownText}
      query={query}
      onQueryChange={setQuery}
      options={(results.data ?? []).map((r) => ({ id: r._id, label: r.display, subtitle: r.subtitle }))}
      loading={results.isLoading}
      open={isOpen}
      onOpenChange={setIsOpen}
      onPick={(option) => {
        setPickedRecord({ id: option.id, label: option.label });
        onValue(option.id);
      }}
      placeholder={tc('ui.link.searchEntity', { entity: target })}
      loadingLabel={tc('ui.link.searching')}
      emptyLabel={tc('ui.select.noResults')}
      ariaLabel={label}
      onClear={
        hasValue
          ? () => {
              setPickedRecord(null);
              setQuery('');
              onValue('');
            }
          : undefined
      }
      clearLabel={tc('ui.action.clear')}
    />
  );
}

/** The AND filters with the quick filter of a field set to a value: the field's filter with
 *  that operator changes in place, or a new one goes last, and an empty value takes it away.
 *  The same list comes back when nothing changes. */
function applyQuickFilter(filters: FilterTuple[], quickFilter: FilterTuple): FilterTuple[] {
  const [field, op, value] = quickFilter;
  const index = filters.findIndex(([name, o]) => name === field && o === op);
  const isEmpty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if (index === -1) return isEmpty ? filters : [...filters, quickFilter];
  if (isEmpty) return filters.filter((_, i) => i !== index);
  if (sameFilters([filters[index]!], [quickFilter])) return filters;
  return filters.map((filter, i) => (i === index ? quickFilter : filter));
}

/* ── Filter panel: editor rows + AND/OR group toggle + Add condition ────────── */

interface FilterPanelProps {
  meta: EntityDefinition;
  filters: FilterTuple[];
  orFilters: FilterTuple[];
  onChange: (and: FilterTuple[], or: FilterTuple[]) => void;
  onClose: () => void;
}

type FilterGroup = 'and' | 'or';

function FilterPanel({ meta, filters, orFilters, onChange, onClose }: FilterPanelProps) {
  const tc = useChrome();
  // Which bucket newly-added rows go to. MVP: a single global AND/OR switch.
  const [group, setGroup] = useState<FilterGroup>(orFilters.length && !filters.length ? 'or' : 'and');
  // The engine answers a filter without a field name with 400, so a row still missing its
  // field or operator stays here, out of the URL and the list request, until it is complete
  // or removed. The panel therefore shows its own rows: the applied filters and those.
  const [shownRows, setShownRows] = useState<Record<FilterGroup, FilterTuple[]>>({ and: filters, or: orFilters });
  // The applied filters also change outside the panel, as when a chip is removed or a view
  // applied; the rows on screen then follow them.
  const [lastApplied, setLastApplied] = useState({ and: filters, or: orFilters });
  if (lastApplied.and !== filters || lastApplied.or !== orFilters) {
    setLastApplied({ and: filters, or: orFilters });
    setShownRows((shown) => ({ and: followApplied(shown.and, filters), or: followApplied(shown.or, orFilters) }));
  }

  const rows = shownRows[group];
  const setRows = (next: FilterTuple[]) => {
    const nextShown = { ...shownRows, [group]: next };
    setShownRows(nextShown);
    if (sameFilters(next.filter(isCompleteFilter), rows.filter(isCompleteFilter))) return;
    onChange(nextShown.and.filter(isCompleteFilter), nextShown.or.filter(isCompleteFilter));
  };

  function addRow(): void {
    setRows([...rows, ['', '', ''] as FilterTuple]);
  }
  function updateRow(i: number, next: FilterTuple): void {
    setRows(rows.map((r, idx) => (idx === i ? next : r)));
  }
  function removeRow(i: number): void {
    setRows(rows.filter((_, idx) => idx !== i));
  }
  function clearAll(): void {
    // The incomplete rows were never applied, so nothing brings their removal back: they go
    // here. The applied rows go once the page applies the empty filters.
    setShownRows((shown) => ({ and: shown.and.filter(isCompleteFilter), or: shown.or.filter(isCompleteFilter) }));
    onChange([], []);
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
                'px-3 py-1 ' + (group === 'and' ? 'bg-primary-600 text-onPrimary' : 'bg-surface text-textMain')
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
                'px-3 py-1 ' + (group === 'or' ? 'bg-primary-600 text-onPrimary' : 'bg-surface text-textMain')
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
              disabled={!shownRows.and.length && !shownRows.or.length}
              onClick={clearAll}
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

/** The rows to show once the applied filters changed. The panel's own change comes back
 *  this way a moment after it is on screen: the rows stay as they are, so the row being
 *  edited keeps its place and its focus. Any other change shows the applied filters, and
 *  the incomplete rows after them. */
function followApplied(shown: FilterTuple[], applied: FilterTuple[]): FilterTuple[] {
  if (sameFilters(shown.filter(isCompleteFilter), applied)) return shown;
  return [...applied, ...shown.filter((row) => !isCompleteFilter(row))];
}

/** Filters compare as the URL carries them. */
function sameFilters(a: FilterTuple[], b: FilterTuple[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
        className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm md:hidden"
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
