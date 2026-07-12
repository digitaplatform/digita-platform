import { useEffect, useState } from 'react';
import { Input, SearchDialog, BaseDialog, TreeView, Combobox, cn } from '@digitaplatform/components';
import type { TreeViewNode, ComboboxOption } from '@digitaplatform/components';
import type { FieldControlProps } from '@/controls/types';
import { FIELD_CLASS, describedBy } from '@/controls/control-styles';
import { useChrome } from '@/lib/chrome-i18n';
import { useSearchLink } from '@/hooks/useSearchLink';
import { useMeta } from '@/hooks/useMeta';
import { resolveLinkFilters } from '@/lib/link-filters';
import { useList } from '@/hooks/useList';

/**
 * Link lookup control on the shared [[Combobox]] (inline mode) — one keyboard
 * contract everywhere: Enter picks and is ALWAYS consumed (no implicit form
 * submit mid-lookup), Tab picks and moves on, Escape closes only the popup.
 * Every pick (all three modes) calls BOTH onChange and onCommit — the grid's
 * entry-flow advance depends on the commit. The current value's display comes
 * from the doc's denormalized `_link_titles`; selecting stores the target `_id`
 * (composite `<parent>::<row_id>` for sub-rows). Read-only → plain display text.
 */
export default function LinkControl({
  field,
  value,
  doc,
  state,
  onChange,
  onCommit,
  controlId,
  labelId,
  describedById,
  errorId,
}: FieldControlProps) {
  const tc = useChrome();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // The just-picked option's label, so the field shows it immediately — the
  // denormalized doc `_link_titles` only refreshes after a server round-trip.
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);

  // search_dialog mode (full-screen picker) state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogQuery, setDialogQuery] = useState('');
  const [dialogDebounced, setDialogDebounced] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  // tree mode (hierarchical picker) state.
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeQuery, setTreeQuery] = useState('');

  // Debounce the query that drives the search (empty/short queries now fire too).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => setDialogDebounced(dialogQuery), 200);
    return () => clearTimeout(t);
  }, [dialogQuery]);

  const titles = doc['_link_titles'] as Record<string, string> | undefined;
  const hasValue = value != null && value !== '';
  // Server title wins once present; `picked` only bridges until the next round-trip
  // refreshes _link_titles (so the field never sticks on a stale picked label).
  const currentDisplay = hasValue
    ? (titles?.[field.fieldname] ?? (picked && picked.id === value ? picked.label : String(value)))
    : '';

  // Dynamic `$doc.<field>` tokens in target_filters resolve against the current doc.
  const resolvedFilters = resolveLinkFilters(
    field.target_filters as Record<string, unknown> | undefined,
    doc,
  );

  const results = useSearchLink({
    entity: field.target,
    q: debounced,
    targetPath: field.target_path,
    filters: resolvedFilters,
    enabled: open,
  });
  const options: ComboboxOption[] = (results.data ?? []).map((r) => ({
    id: r._id,
    label: r.display,
    subtitle: r.subtitle,
  }));

  // search_dialog: columns (from config, else the target's search_fields) with
  // labels from the target meta; rows carry those column values.
  const targetMeta = useMeta(field.target);
  const treeCfg = targetMeta.data?.tree;
  // Whole (small) tree loaded once the dialog opens, scoped by the resolved filters
  // AND auto-scoped by the tree's own partition (`tree.group_by`, e.g. `domain`):
  // a self-referential parent field on a partitioned tree must only offer nodes in
  // the SAME partition (picking a "sales" group's parent shows only the sales
  // forest, not all four domains interleaved). Explicit target_filters win.
  const treeGroupBy = treeCfg?.group_by;
  const partitionValue =
    treeGroupBy ? (doc as Record<string, unknown>)[treeGroupBy] : undefined;
  const treeFilters: Record<string, unknown> = { ...(resolvedFilters ?? {}) };
  if (
    treeGroupBy &&
    partitionValue != null &&
    partitionValue !== '' &&
    !(treeGroupBy in treeFilters)
  ) {
    treeFilters[treeGroupBy] = partitionValue;
  }
  const treeList = useList(treeCfg && treeOpen ? field.target : undefined, {
    filters: Object.entries(treeFilters).map(([k, v]) => [k, '=', v] as [string, string, unknown]),
    page_size: 2000,
  });
  const searchColumns = field.search_columns ?? targetMeta.data?.search_fields ?? [];
  const colDefs = searchColumns.map((key) => ({
    key,
    label: targetMeta.data?.fields?.find((f) => f.fieldname === key)?.label ?? key,
  }));
  const dialogResults = useSearchLink({
    entity: field.target,
    q: dialogDebounced,
    targetPath: field.target_path,
    filters: resolvedFilters,
    fields: searchColumns,
    enabled: dialogOpen,
  });
  const dialogRows = (dialogResults.data ?? []).map((r) => ({
    _id: r._id,
    display: r.display,
    ...(r.fields ?? {}),
  }));

  if (state.readOnly) {
    return (
      <div
        id={controlId}
        // C3 locked look, stated EXPLICITLY: a <div> never carries the `readonly`
        // attribute, so FIELD_CLASS's `[&[readonly]]` treatment can't apply here —
        // subtle fill, no outline/elevation; dark keeps the hairline borderStrong
        // edge. cn's tailwind-merge lets these override FIELD_CLASS's border-border.
        className={cn(FIELD_CLASS, 'bg-subtle border-transparent shadow-none dark:border-borderStrong')}
        aria-labelledby={labelId}
      >
        {currentDisplay || '—'}
      </div>
    );
  }

  // EVERY pick path commits: the onCommit contract exists precisely so a grid
  // cell editor can close and the entry-flow can advance after a Link pick.
  const select = (opt: { _id: string; display: string }) => {
    setPicked({ id: opt._id, label: opt.display });
    onChange(opt._id);
    setOpen(false);
    onCommit?.();
  };

  // ---- tree mode: target entity declares a tree → pick from the hierarchy ----
  if (treeCfg) {
    const labelField = treeCfg.label_field ?? targetMeta.data?.title_field ?? '_id';
    const parentField = treeCfg.parent_field;
    const nodes: TreeViewNode[] = (treeList.data?.rows ?? []).map((r) => {
      const parent = r[parentField];
      return {
        id: String(r._id),
        label: String(r[labelField] ?? r._id),
        parentId: parent != null && parent !== '' ? String(parent) : null,
      };
    });
    // Picking a PARENT for this very node: block the node itself and its whole
    // subtree so a cycle can never be selected (previously only caught at save).
    let disabledIds: Set<string> | undefined;
    const selfId = doc['_id'] != null && doc['_id'] !== '' ? String(doc['_id']) : '';
    if (field.fieldname === parentField && selfId) {
      const kids = new Map<string, string[]>();
      for (const n of nodes) {
        if (!n.parentId) continue;
        const arr = kids.get(n.parentId);
        if (arr) arr.push(n.id);
        else kids.set(n.parentId, [n.id]);
      }
      const blocked = new Set<string>([selfId]);
      const stack = [selfId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const c of kids.get(cur) ?? []) if (!blocked.has(c)) { blocked.add(c); stack.push(c); }
      }
      disabledIds = blocked;
    }
    return (
      <>
        <div className="relative">
          <Input
            id={controlId}
            type="text"
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={treeOpen}
            aria-labelledby={labelId}
            aria-describedby={describedBy(describedById, errorId)}
            aria-required={state.required || undefined}
            aria-invalid={state.invalid || undefined}
            readOnly
            placeholder={field.placeholder ?? tc('ui.link.searchEntity', { entity: field.target ?? '' })}
            value={currentDisplay}
            // Open on CLICK or explicit keys only — never onFocus: the dialog's
            // focus-restore lands here on close, and an onFocus-open turned
            // every close into an immediate reopen (un-dismissable dialog).
            onClick={() => setTreeOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
                e.preventDefault();
                setTreeOpen(true);
              }
            }}
            className={hasValue ? 'pr-16' : 'pr-8'}
          />
          {hasValue && (
            <button
              type="button"
              aria-label={tc('ui.action.clear')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(null)}
              className="absolute right-9 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain"
            >
              ×
            </button>
          )}
          <button
            type="button"
            aria-label={tc('ui.list.search')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTreeOpen(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain"
          >
            <SearchIcon />
          </button>
        </div>
        <BaseDialog
          open={treeOpen}
          onClose={() => setTreeOpen(false)}
          title={tc('ui.link.searchEntity', { entity: field.target ?? '' })}
          size="lg"
        >
          <Input
            autoFocus
            type="text"
            role="searchbox"
            aria-label={tc('ui.list.search')}
            placeholder={tc('ui.list.search')}
            value={treeQuery}
            onChange={(e) => setTreeQuery(e.target.value)}
            className="mb-3"
          />
          <TreeView
            nodes={nodes}
            selectedId={hasValue ? String(value) : null}
            query={treeQuery}
            disabledIds={disabledIds}
            emptyLabel={treeList.isLoading ? tc('ui.link.searching') : tc('ui.select.noResults')}
            onSelect={(id) => {
              const node = nodes.find((n) => n.id === id);
              setTreeOpen(false);
              select({ _id: id, display: node?.label ?? id });
            }}
          />
        </BaseDialog>
      </>
    );
  }

  // ---- search_dialog mode: full-screen picker instead of the inline dropdown ----
  if (field.search_dialog) {
    const minChars = field.search_min_chars ?? 1;
    const showButton = field.search_button !== false;
    const openDialog = () => {
      setDialogQuery(query);
      setDialogOpen(true);
    };
    // Show the typed query only while the user is actually composing one (or
    // the dialog is open) — right after a pick the field shows the label, not
    // an empty string that reads as "the takeover failed".
    const displayValue = inputFocused && (query !== '' || dialogOpen) ? query : currentDisplay;
    return (
      <>
        <div className="relative">
          <Input
            id={controlId}
            type="text"
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={dialogOpen}
            aria-labelledby={labelId}
            aria-describedby={describedBy(describedById, errorId)}
            aria-required={state.required || undefined}
            aria-invalid={state.invalid || undefined}
            placeholder={
              field.placeholder ?? tc('ui.link.searchEntity', { entity: field.target ?? '' })
            }
            value={displayValue}
            onFocus={() => {
              setInputFocused(true);
              setQuery('');
            }}
            onBlur={() => setInputFocused(false)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter/ArrowDown open the picker (>= min_chars); Tab NEVER
              // opens a dialog — it must stay the fast way THROUGH a form.
              if (e.key === 'Enter') {
                e.preventDefault(); // even below min_chars: no implicit submit
                e.stopPropagation();
                if (query.trim().length >= minChars) openDialog();
              } else if (e.key === 'ArrowDown' && query.trim().length >= minChars) {
                e.preventDefault();
                e.stopPropagation();
                openDialog();
              }
            }}
            className={showButton ? 'pr-16' : hasValue ? 'pr-8' : 'pr-2'}
          />
          {hasValue && (
            <button
              type="button"
              aria-label={tc('ui.action.clear')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(null);
                setQuery('');
              }}
              className={`absolute ${showButton ? 'right-9' : 'right-2'} top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain`}
            >
              ×
            </button>
          )}
          {showButton && (
            <button
              type="button"
              aria-label={tc('ui.list.search')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openDialog}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain"
            >
              <SearchIcon />
            </button>
          )}
        </div>
        <SearchDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title={tc('ui.link.searchEntity', { entity: field.target ?? '' })}
          query={dialogQuery}
          onQueryChange={setDialogQuery}
          columns={colDefs}
          rows={dialogRows}
          getRowId={(r) => r._id}
          onPick={(r) => {
            setDialogOpen(false);
            setQuery('');
            select({ _id: r._id, display: String(r.display ?? r._id) });
          }}
          loading={dialogResults.isLoading}
          searchPlaceholder={tc('ui.list.search')}
          emptyLabel={tc('ui.select.noResults')}
          loadingLabel={tc('ui.link.searching')}
        />
      </>
    );
  }

  // ---- inline mode: the shared Combobox owns the whole keyboard machine ----
  return (
    <Combobox
      id={controlId}
      value={currentDisplay}
      query={query}
      onQueryChange={setQuery}
      options={options}
      loading={results.isLoading}
      open={open}
      onOpenChange={setOpen}
      onPick={(opt) => select({ _id: opt.id, display: opt.label })}
      placeholder={field.placeholder ?? (field.target ? tc('ui.link.searchEntity', { entity: field.target }) : tc('ui.list.search'))}
      loadingLabel={tc('ui.link.searching')}
      emptyLabel={tc('ui.select.noResults')}
      invalid={state.invalid}
      required={state.required}
      ariaLabelledby={labelId}
      ariaDescribedby={describedBy(describedById, errorId)}
      onClear={
        hasValue
          ? () => {
              onChange(null); // null (not undefined) survives JSON.stringify so the clear reaches the engine
              setQuery('');
            }
          : undefined
      }
      clearLabel={tc('ui.action.clear')}
    />
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m13.5 13.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
