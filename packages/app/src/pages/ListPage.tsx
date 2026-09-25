import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useMeta } from '@/hooks/useMeta';
import { useList } from '@/hooks/useList';
import { useListPreferences } from '@/hooks/useListPreferences';
import {
  parseUrlFilter,
  objectFilterToTuples,
  effectiveFilters,
  parseFilterTuplesParam,
  serializeFilterTuples,
  parseColumnsParam,
  serializeColumns,
  normalizeListParams,
  type FilterTuple,
} from '@/lib/filter-from-url';
import type { ListPreferenceDoc, ViewVisibility } from '@/services/listPreference';
import { hasEntityPermission, type PermAction } from '@/lib/permissions';
import { useSessionStore } from '@/stores/session';
import { SegmentedControl, ReportPreviewDialog } from '@digitaplatform/components';
import { ListRenderer } from '@/components/render/ListRenderer';
import { TreeEditor } from '@/components/render/TreeEditor';
import { ListToolbar } from '@/components/list/ListToolbar';
import { ImportWizard } from '@/components/list/ImportWizard';
import { LoadingBlock, ErrorBlock } from '@/components/status';
import { TableSkeleton } from '@digitaplatform/components';
import { useChrome } from '@/lib/chrome-i18n';
import { useI18nStore } from '@/stores/i18n';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { getList } from '@/services/resource';
import { api } from '@/services/api';
import { useQueryClient } from '@tanstack/react-query';
import { qkPrefix } from '@/lib/query-keys';
import { buildListCsv, downloadCsv } from '@/lib/csv';
import { nextSort } from '@/lib/sort';
import { tid } from '@/lib/testid';
import { reportRenderUrl, resolveReportParams } from '@/lib/report-link';
import { RowPrintButton } from '@/components/workflow/RowPrintButton';
import { useRealtimeEntity } from '@/hooks/useRealtime';
import RecordPage from '@/pages/RecordPage';

/** The structural URL params that, when present, "fork" an applied view into an
 *  edited (modified) state. page/q are ephemeral and allowed alongside a view. */
const OVERRIDE_PARAMS = ['f', 'of', 'cols', 'order_by', 'page_size'] as const;

/**
 * Generic list for any entity. A saved view (ListPreference) is applied BY
 * REFERENCE: the URL carries only `?view=<id>` and the filters/columns/sort are
 * read from the view, so the URL stays clean. Editing any structural param forks
 * the view into a "modified" state (the edited param lands in the URL next to
 * `?view`); Save overwrites the view, Save-as creates a new one, Reset discards
 * the edits. On bare entry the user's default view (or the org default) is
 * applied automatically. is_single entities have no list → render the record.
 */
export default function ListPage() {
  const { entity } = useParams<{ entity: string }>();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const tc = useChrome();
  const tField = useI18nStore((s) => s.tField);
  const dialog = useDialogHost();

  const metaQ = useMeta(entity);
  const meta = metaQ.data;

  // Per-row print: the primary (or first) permission-permitted report link. The
  // permission gate is entity-level (row-independent) and copies PrintMenu's
  // printModelled read-fallback exactly; the link's per-row `show_if` is applied
  // in RowPrintButton. The dialog is a single page-level instance keyed by the
  // active row (`printRow`) so the list stays lightweight.
  const [printRow, setPrintRow] = useState<Record<string, unknown> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();
  const printLink = useMemo(() => {
    if (!meta) return null;
    const printModelled = (meta.permissions ?? []).some((p) => p.print !== undefined);
    const permitted = (meta.reports ?? []).filter((link) => {
      const required = (link.requires_permission ?? 'print') as PermAction;
      return required === 'print' && !printModelled
        ? hasEntityPermission(meta, user, 'read')
        : hasEntityPermission(meta, user, required);
    });
    return permitted.find((l) => l.primary) ?? permitted[0] ?? null;
  }, [meta, user]);

  // Live-sync: refresh this list when another user (or tab) writes to the entity.
  useRealtimeEntity(entity);

  // ── URL → raw params ───────────────────────────────────────────────────────
  const page = Number(sp.get('page') ?? '1') || 1;
  const search = sp.get('q') ?? '';
  const orderByParam = sp.get('order_by') ?? undefined;
  const filterRaw = sp.get('filter'); // nav-seed object
  const fParam = sp.get('f');
  const ofParam = sp.get('of');
  const colsParam = sp.get('cols');
  const pageSizeParam = sp.get('page_size');
  const viewId = sp.get('view') ?? undefined;
  const display = sp.get('display') ?? undefined;

  const navTuples = useMemo(() => objectFilterToTuples(parseUrlFilter(filterRaw)), [filterRaw]);
  const urlTuples = useMemo(() => parseFilterTuplesParam(fParam), [fParam]);
  const urlOrFilters = useMemo(() => parseFilterTuplesParam(ofParam), [ofParam]);
  const urlColumns = useMemo(() => parseColumnsParam(colsParam), [colsParam]);

  // ── Saved views (own + shared) ─────────────────────────────────────────────
  const isListable = !!meta && !meta.is_single;
  const prefs = useListPreferences(isListable ? entity : undefined);
  const activeView = prefs.views.find((v) => v._id === viewId);

  // ── Effective state = URL override ?? applied view ?? default ───────────────
  // An override param present while a view is applied = a "fork" (modified).
  const modified = !!activeView && OVERRIDE_PARAMS.some((p) => sp.has(p));
  const effTuples = useMemo(
    () => (fParam !== null ? urlTuples : (activeView?.filters ?? [])),
    [fParam, urlTuples, activeView],
  );
  const effOrFilters = useMemo(
    () => (ofParam !== null ? urlOrFilters : (activeView?.or_filters ?? [])),
    [ofParam, urlOrFilters, activeView],
  );
  const effColumns = useMemo(
    () => (colsParam !== null ? urlColumns : (activeView?.columns ?? [])),
    [colsParam, urlColumns, activeView],
  );
  const effOrderByRaw = orderByParam ?? activeView?.order_by;
  const orderBy =
    effOrderByRaw ??
    (meta?.default_sort ? `${meta.default_sort.field} ${meta.default_sort.order}` : undefined);
  const pageSize = Number(pageSizeParam ?? '') || activeView?.page_size || 20;

  // A view's own filters are authoritative (drop the nav seed), like the FilterBar.
  const viewFiltersActive =
    !!activeView &&
    !sp.has('f') &&
    !sp.has('of') &&
    ((activeView.filters?.length ?? 0) > 0 || (activeView.or_filters?.length ?? 0) > 0);
  const barActive = sp.has('f') || sp.has('of') || viewFiltersActive;
  const filters: FilterTuple[] = useMemo(
    () => effectiveFilters(navTuples, effTuples, barActive),
    [navTuples, effTuples, barActive],
  );

  // Auto-apply the default view on bare entry (no view, no override, no nav seed,
  // no search). Runs once per mount so the user can clear to "All records" and
  // stay there; a fresh navigation remounts and re-applies the default.
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultRef.current || !isListable || prefs.isLoading) return;
    const bare =
      !viewId && !filterRaw && !search && OVERRIDE_PARAMS.every((p) => !sp.has(p));
    appliedDefaultRef.current = true;
    if (bare && prefs.defaultView) {
      const next = new URLSearchParams(sp);
      next.set('view', prefs.defaultView._id);
      setSp(next, { replace: true });
    }
  }, [isListable, prefs.isLoading, prefs.defaultView, viewId, filterRaw, search, sp, setSp]);

  const listQ = useList(isListable ? entity : undefined, {
    page,
    page_size: pageSize,
    search,
    order_by: orderBy,
    filters,
    or_filters: effOrFilters,
  });

  if (metaQ.isLoading) return <LoadingBlock />;
  if (metaQ.isError || !meta) {
    return (
      <ErrorBlock
        title={tc('ui.entity.notFound')}
        detail={metaQ.error instanceof Error ? metaQ.error.message : String(entity)}
      />
    );
  }

  // Singles have no list — render the record form for the one row.
  if (meta.is_single) return <RecordPage />;

  const canCreate = hasEntityPermission(meta, user, 'create');
  // Import is new + destructive → require the modeled `import` bit with NO
  // read-fallback (Administrator still bypasses inside hasEntityPermission).
  const canImport = hasEntityPermission(meta, user, 'import');
  // Round-trip export hits the engine endpoint (enforces the `export` bit). Gate
  // the button with the PrintMenu modeled-fallback idiom: require the bit only
  // when some permission row models `export`, else fall back to `read` so
  // never-modeled entities keep an ungated affordance.
  const exportModelled = (meta.permissions ?? []).some((p) => p.export !== undefined);
  const canExportRoundTrip = exportModelled
    ? hasEntityPermission(meta, user, 'export')
    : hasEntityPermission(meta, user, 'read');
  const treeMode = !!meta.tree && display === 'tree';

  // ── URL writers ────────────────────────────────────────────────────────────
  // Keep `?view` while patching structural params → editing FORKS the view.
  const updateParam = (patch: Record<string, string | undefined>, resetPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setSp(next, { replace: true });
  };

  const onSort = (fieldname: string, additive = false) => {
    updateParam({ order_by: nextSort(orderBy, fieldname, additive) }, true);
  };

  const EXPORT_CAP = 5000;
  const onExport = async () => {
    try {
      const res = await getList(
        entity!,
        normalizeListParams({
          page: 1,
          page_size: EXPORT_CAP,
          search,
          order_by: orderBy,
          filters,
          or_filters: effOrFilters,
        }),
      );
      const exported = (res.data ?? []) as Record<string, unknown>[];
      const csv = buildListCsv(meta, exported, effColumns, (f) => tField(entity!, f.fieldname, f.label));
      downloadCsv(`${entity}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      const total = res.meta?.total ?? exported.length;
      dialog.toast(
        total > exported.length
          ? tc('ui.list.exportTruncated', { count: exported.length, total })
          : tc('ui.list.exported', { count: exported.length }),
        'success',
      );
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : tc('ui.list.exportFailed'), 'error');
    }
  };

  // Round-trip export via the engine endpoint: links as business keys, no system
  // fields → a re-importable CSV. Reuses the current filter set.
  const onExportRoundTrip = async () => {
    try {
      const text = await api.get<string>(`/api/v1/export/${encodeURIComponent(entity!)}`, {
        format: 'csv',
        round_trip: true,
        filters: JSON.stringify(filters),
      });
      downloadCsv(`${entity}-roundtrip-${new Date().toISOString().slice(0, 10)}.csv`, text);
    } catch (e) {
      dialog.toast(e instanceof Error ? e.message : tc('ui.list.exportFailed'), 'error');
    }
  };

  // ── ListToolbar callbacks ──────────────────────────────────────────────────
  const onFiltersChange = (and: FilterTuple[], or: FilterTuple[]) =>
    updateParam({ f: serializeFilterTuples(and), of: serializeFilterTuples(or) }, true);

  const onColumnsChange = (cols: string[]) => updateParam({ cols: serializeColumns(cols) });

  /** Apply a view by reference: only `?view=<id>` stays, all overrides cleared. */
  const onApplyView = (id: string) => {
    const next = new URLSearchParams();
    next.set('view', id);
    setSp(next, { replace: true });
  };

  /** Discard edits, back to the clean applied view. */
  const onResetView = () => {
    if (!viewId) return;
    const next = new URLSearchParams();
    next.set('view', viewId);
    setSp(next, { replace: true });
  };

  /** Leave any view — the unfiltered list. */
  const onAllRecords = () => {
    appliedDefaultRef.current = true; // don't re-apply the default after an explicit clear
    setSp(new URLSearchParams(), { replace: true });
  };

  /** The mutable part of a saved view, taken from the EFFECTIVE (applied) state. */
  const currentViewBody = (): Partial<ListPreferenceDoc> => ({
    filters: effTuples,
    or_filters: effOrFilters,
    columns: effColumns.length ? effColumns : null,
    order_by: effOrderByRaw,
    page_size: pageSize,
  });

  const onSaveView = (
    name: string,
    visibility: ViewVisibility,
    roles: string[],
    users: string[],
  ) => {
    prefs.create.mutate(
      {
        ...currentViewBody(),
        view_name: name,
        visibility,
        shared_with_roles: visibility === 'shared' ? roles : null,
        shared_with_users: visibility === 'shared' ? users : null,
        owner_name: user?.full_name ?? user?.email,
      },
      { onSuccess: (doc) => onApplyView(doc._id) },
    );
  };

  // Overwrite the active view with the current edits, then clear the fork.
  const onUpdateView = (id: string) =>
    prefs.update.mutate({ id, body: currentViewBody() }, { onSuccess: onResetView });

  const onDeleteView = (id: string) => {
    prefs.remove.mutate(id, {
      onSuccess: () => {
        if (viewId === id) onAllRecords();
      },
    });
  };

  const onSetDefaultView = (id: string) => void prefs.setDefault(id);
  const onClearDefaultView = (id: string) => prefs.update.mutate({ id, body: { is_default: 0 } });
  const onSetOrgDefaultView = (id: string) => void prefs.setOrgDefault(id);
  const onClearOrgDefaultView = (id: string) => prefs.update.mutate({ id, body: { is_org_default: 0 } });

  // canSaveView: an unsaved fork of a view, or (no view) any state worth saving.
  const canSaveView = activeView
    ? modified
    : effTuples.length > 0 || effOrFilters.length > 0 || effColumns.length > 0;

  // Report-preview URLs for the active print row (see printLink/printRow above).
  const printParams = printLink && printRow ? resolveReportParams(printLink, printRow) : {};
  const printFormats = printLink?.formats ?? ['pdf'];

  return (
    <div className="space-y-3" {...tid.page('list', entity)}>
      <ListToolbar
        entity={entity!}
        meta={meta}
        total={listQ.data?.total}
        search={search}
        filters={effTuples}
        orFilters={effOrFilters}
        columns={effColumns}
        savedViews={prefs.views}
        activeViewId={viewId}
        modified={modified}
        canSaveView={canSaveView}
        canCreate={canCreate}
        isAdmin={prefs.isAdmin}
        canEditView={prefs.canEdit}
        onSearch={(q) => updateParam({ q: q || undefined }, true)}
        onFiltersChange={onFiltersChange}
        onColumnsChange={onColumnsChange}
        onApplyView={onApplyView}
        onResetView={onResetView}
        onAllRecords={onAllRecords}
        onSaveView={onSaveView}
        onUpdateView={onUpdateView}
        onDeleteView={onDeleteView}
        onSetDefaultView={onSetDefaultView}
        onClearDefaultView={onClearDefaultView}
        onSetOrgDefaultView={onSetOrgDefaultView}
        onClearOrgDefaultView={onClearOrgDefaultView}
        onExport={onExport}
        onExportRoundTrip={canExportRoundTrip ? onExportRoundTrip : undefined}
        onImport={canImport ? () => setImportOpen(true) : undefined}
        onCreate={() => navigate(`/${entity}/new`)}
      />

      {canImport && (
        <ImportWizard
          entity={entity!}
          meta={meta}
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: qkPrefix.lists(entity!) })}
        />
      )}

      {meta.tree && (
        <SegmentedControl
          aria-label={tc('ui.tree.viewTree')}
          value={treeMode ? 'tree' : 'list'}
          onChange={(v) => updateParam({ display: v === 'tree' ? 'tree' : undefined })}
          options={[
            { value: 'list', label: tc('ui.tree.viewList') },
            { value: 'tree', label: tc('ui.tree.viewTree') },
          ]}
        />
      )}

      {treeMode ? (
        <TreeEditor entity={entity!} meta={meta} tree={meta.tree!} />
      ) : listQ.isLoading ? (
        <TableSkeleton columns={5} rows={10} />
      ) : listQ.isError ? (
        <ErrorBlock
          title={tc('ui.list.loadFailed')}
          detail={listQ.error instanceof Error ? listQ.error.message : tc('ui.status.somethingWrong')}
        />
      ) : (
        <ListRenderer
          entity={entity!}
          meta={meta}
          rows={listQ.data!.rows}
          orderBy={orderBy}
          page={listQ.data!.page}
          total={listQ.data!.total}
          totalPages={listQ.data!.totalPages}
          visibleColumns={effColumns}
          canCreate={canCreate}
          isFetching={listQ.isFetching}
          onRowClick={(name) => navigate(`/${entity}/${encodeURIComponent(name)}`)}
          onCreate={() => navigate(`/${entity}/new`)}
          onSort={onSort}
          onPageChange={(p) => updateParam({ page: String(p) })}
          rowActions={
            printLink
              ? (row) => <RowPrintButton link={printLink} doc={row} onPrint={setPrintRow} />
              : undefined
          }
        />
      )}

      {printLink && printRow && (
        <ReportPreviewDialog
          open
          onClose={() => setPrintRow(null)}
          title={printLink.label ?? printLink.report}
          src={reportRenderUrl(printLink.report, printParams, 'html')}
          printHref={reportRenderUrl(printLink.report, printParams, 'html', { print: true })}
          downloads={printFormats
            .filter((f) => f !== 'html')
            .map((f) => ({ label: f.toUpperCase(), href: reportRenderUrl(printLink.report, printParams, f) }))}
        />
      )}
    </div>
  );
}
