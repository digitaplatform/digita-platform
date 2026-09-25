import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, type Resolver } from 'react-hook-form';
import { Lock } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import type { EntityDefinition } from '@digitaplatform/shared';
import { LAYOUT_FIELD_TYPES } from '@digitaplatform/shared';
import { Button } from '@digitaplatform/components';
import { useMeta } from '@/hooks/useMeta';
import { useDocument, useSingle, useCreate, useUpdate, useDeleteDoc } from '@/hooks/useDocument';
import { usePreview } from '@/hooks/usePreview';
import { getDoc, getSingle } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { buildZodSchema } from '@/lib/schema-from-meta';
import { mergePreviewRows, RECOMPUTE_OVERRIDES_KEY } from '@/lib/merge-preview-rows';
import { resolveFetchFromTargets } from '@/lib/resolve-fetch-from';
import {
  sweepFieldStates,
  deriveComputedSet,
  deriveFrozenSet,
  deriveAllowOnSubmitSet,
  type FieldStateMap,
} from '@/lib/evaluate-field';
import { writableLevelPredicate, hasEntityPermission } from '@/lib/permissions';
import { toUiMessages, unwrap, type UiMessage } from '@/lib/api-result';
import { ApiClientError } from '@/lib/errors';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { FormRenderer } from '@/components/render/FormRenderer';
import { StatusBadge } from '@/components/render/cells';
import { ContextPanel } from '@/components/record/ContextPanel';
import { WorkflowBar } from '@/components/workflow/WorkflowBar';
import { ActionBar } from '@/components/workflow/ActionBar';
import { PrintMenu } from '@/components/workflow/PrintMenu';
import { RecordActions } from '@/components/render/RecordActions';
import { LoadingBlock, ErrorBlock, FormErrorSummary } from '@/components/status';
import { FormSkeleton } from '@digitaplatform/components';
import { RecordSkeleton } from '@/components/render/RecordSkeleton';
import { useDialogHost } from '@/components/overlay/DialogHost';
import { useChrome } from '@/lib/chrome-i18n';
import { formatCurrency } from '@/lib/format';
import { useRecordTitle } from '@/stores/record-title';
import { useRealtimeEntity } from '@/hooks/useRealtime';
import { tid } from '@/lib/testid';

type Doc = Record<string, unknown>;

/** Auto-composed KPI band for the record hero: the important Currency fields (bold or
 *  in_list_view) shown as figures. Renders nothing for entities without money fields. */
function RecordKpis({ entity, meta, doc }: { entity: string; meta: EntityDefinition; doc: Record<string, unknown> }) {
  const formatLocale = useSessionStore((s) => s.locale?.format_locale);
  const defaultCurrency = useSessionStore((s) => s.settings?.default_currency);
  const tField = useI18nStore((s) => s.tField);
  const kpis = (meta.fields ?? []).filter(
    (f) =>
      f.fieldtype === 'Currency' &&
      (f.bold || f.in_list_view) &&
      doc[f.fieldname] != null &&
      doc[f.fieldname] !== '',
  );
  if (kpis.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
      {kpis.slice(0, 3).map((f) => {
        const cf = f.currency_field ? String(doc[f.currency_field] ?? '') : '';
        return (
          <div key={f.fieldname}>
            <div className="text-xs uppercase tracking-wide text-textMuted">
              {tField(entity, f.fieldname, f.label)}
            </div>
            <div className="text-h1 font-display tabular-nums text-textMain">
              {formatCurrency(doc[f.fieldname], formatLocale, cf || defaultCurrency)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Loader shell: resolves meta + the document (or a new-doc seed), then mounts the
 *  form ONCE the data is ready so the form's hooks see real values. */
export default function RecordPage() {
  const params = useParams<{ entity: string; name?: string }>();
  const entity = params.entity!;
  const name = params.name;

  // Live-sync: another user's write to this entity invalidates the cached doc/list
  // (the open form keeps unsaved edits — RecordForm only re-syncs when pristine).
  useRealtimeEntity(entity);

  const metaQ = useMeta(entity);
  const isSingle = !!metaQ.data?.is_single;
  const isNew = !isSingle && !name;

  const docQ = useDocument<Doc>(isSingle || isNew ? undefined : entity, isSingle || isNew ? undefined : name);
  const singleQ = useSingle<Doc>(isSingle ? entity : undefined);
  const loaded = isSingle ? singleQ : docQ;
  const tc = useChrome();

  if (metaQ.isLoading) return <FormSkeleton fields={8} />;
  if (metaQ.isError || !metaQ.data) {
    const e = metaQ.error;
    return (
      <ErrorBlock
        title={tc('ui.entity.notFound')}
        detail={e instanceof Error ? e.message : String(e ?? entity)}
      />
    );
  }

  // Meta is known here (the doc is still loading) → the skeleton can mirror the real
  // record geometry from metadata, so nothing shifts when the document settles (BUG-2).
  if (!isNew && loaded.isLoading) return <RecordSkeleton meta={metaQ.data} />;
  if (!isNew && loaded.isError) {
    const e = loaded.error;
    const notFound = e instanceof ApiClientError && e.status === 404;
    return (
      <ErrorBlock
        title={notFound ? tc('ui.record.notFound') : tc('ui.record.loadFailed')}
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const initial: Doc = isNew ? buildSeed(metaQ.data) : (loaded.data as Doc);
  if (!initial) return <LoadingBlock />;

  return (
    <RecordForm
      key={`${entity}/${name ?? 'new'}`}
      entity={entity}
      meta={metaQ.data}
      initial={initial}
      isNew={isNew}
      isSingle={isSingle}
      name={isSingle ? (initial['_id'] as string) : name}
    />
  );
}

function buildSeed(meta: EntityDefinition): Doc {
  const seed: Doc = { docstatus: 0 };
  for (const f of meta.fields) {
    if (f.default === undefined) continue;
    if (f.fieldtype === 'Date' && f.default === '__today__') {
      seed[f.fieldname] = new Date().toISOString().slice(0, 10);
    } else {
      seed[f.fieldname] = f.default;
    }
  }
  return seed;
}

const DISPLAY_ONLY_KEYS = new Set([
  '_link_titles',
  '_status_indicator',
  // Transient per-row marker of user-overridden `recompute` cells — client-only,
  // never persisted (see mergePreviewRows / TableControl).
  RECOMPUTE_OVERRIDES_KEY,
]);

/** Drop the same DISPLAY_ONLY_KEYS from a single child-table row. Mirrors the
 *  top-level strip below — a row's `_link_titles` (seeded client-side so a
 *  freshly-picked link shows its title instead of the raw id — see
 *  TableControl.addLinkRow) is exactly as transient as the top-level one
 *  and must never reach the stored document, or it goes stale the moment the
 *  linked record's title changes. */
function stripRow(row: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(row)) {
    if (DISPLAY_ONLY_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export function stripForSave(meta: EntityDefinition, values: Doc, original?: Doc): Doc {
  const drop = new Set<string>(DISPLAY_ONLY_KEYS);
  const tableFields = new Set<string>();
  for (const f of meta.fields) {
    if (LAYOUT_FIELD_TYPES.includes(f.fieldtype) || f.fieldtype === 'ReadOnly') drop.add(f.fieldname);
    if (f.fieldtype === 'Table') tableFields.add(f.fieldname);
  }
  const out: Doc = {};
  for (const [k, v] of Object.entries(values)) {
    if (drop.has(k)) continue;
    if (tableFields.has(k) && Array.isArray(v)) {
      out[k] = v.map((row) => (row && typeof row === 'object' ? stripRow(row as Doc) : row));
      continue;
    }
    // A field cleared back to empty (undefined) that HELD a value when loaded must be
    // sent as an explicit null — otherwise JSON.stringify drops the key and the engine
    // keeps the old value, so the clear wouldn't persist. On create (no `original`) we
    // leave it out so field defaults still apply.
    out[k] = v === undefined && original && original[k] != null ? null : v;
  }
  return out;
}

function RecordForm({
  entity,
  meta,
  initial,
  isNew,
  isSingle,
  name,
}: {
  entity: string;
  meta: EntityDefinition;
  initial: Doc;
  isNew: boolean;
  isSingle: boolean;
  name?: string;
}) {
  const navigate = useNavigate();
  const dialog = useDialogHost();
  const qc = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const t = useI18nStore((s) => s.t);
  const tEntity = useI18nStore((s) => s.tEntity);
  const tc = useChrome();

  const computedSet = useMemo(() => deriveComputedSet(meta), [meta]);
  const frozenSet = useMemo(() => deriveFrozenSet(meta), [meta]);
  const allowOnSubmitSet = useMemo(() => deriveAllowOnSubmitSet(meta), [meta]);
  // Per child-table, the cells a preview may write back: `owned` = server-owned
  // (read-only) cells, always taken from the preview; `derived` = editable cells the
  // server also derives (`recompute`), refreshed whenever their inputs change unless
  // the user overrode them; `fillable` = editable cells the server resolves (e.g.
  // price / fetch_from), taken only when the row's cell is still empty so a user entry
  // is never overwritten.
  const tableMergeSets = useMemo(() => {
    const m = new Map<string, { owned: string[]; derived: string[]; fillable: string[] }>();
    for (const f of meta.fields) {
      if (f.fieldtype !== 'Table' || !f.child_fields) continue;
      const owned: string[] = [];
      const derived: string[] = [];
      const fillable: string[] = [];
      for (const cf of f.child_fields) {
        if (LAYOUT_FIELD_TYPES.includes(cf.fieldtype) || cf.fieldtype === 'Table') continue;
        if (cf.read_only) owned.push(cf.fieldname);
        else if (cf.recompute) derived.push(cf.fieldname);
        else fillable.push(cf.fieldname);
      }
      m.set(f.fieldname, { owned, derived, fillable });
    }
    return m;
  }, [meta]);
  const canWriteLevel = useMemo(() => writableLevelPredicate(meta, user), [meta, user]);
  const hasTable = useMemo(() => meta.fields.some((f) => f.fieldtype === 'Table'), [meta]);

  // Live required resolver via a ref → the zod schema instance stays stable.
  const stateRef = useRef<FieldStateMap>({});
  const requiredResolver = useRef((fn: string) => stateRef.current[fn]?.required ?? false).current;
  const schema = useMemo(() => buildZodSchema(meta, requiredResolver), [meta, requiredResolver]);
  // zodResolver runs a v3 schema correctly at runtime; the monorepo hoists a zod v4
  // whose ZodType the resolver's .d.ts references, so cast the arg (type-only friction).
  const resolver = useMemo(
    () => zodResolver(schema as never) as unknown as Resolver<Doc>,
    [schema],
  );

  const form = useForm<Doc>({
    resolver,
    defaultValues: initial as never,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });

  const watched = form.watch();
  const docstatus = Number((watched['docstatus'] ?? initial['docstatus'] ?? 0) as number);
  // Any Link field with a declared context_view AND a current value activates
  // the two-column layout with the metadata-driven side panel.
  const hasContext = meta.fields.some(
    (f) =>
      f.fieldtype === 'Link' &&
      f.context_view &&
      watched[f.fieldname] != null &&
      watched[f.fieldname] !== '',
  );

  const preview = usePreview<Doc>(entity, { enabled: hasTable });

  const fieldState = useMemo(() => {
    const map = sweepFieldStates(meta.fields, {
      scope: { doc: watched, user: (user as unknown as Record<string, unknown>) ?? {} },
      computedSet,
      frozenSet,
      docstatus,
      isSubmittable: !!meta.is_submittable,
      allowOnSubmitSet,
      isNew,
      canWriteLevel,
    });
    stateRef.current = map;
    return map;
  }, [watched, meta, computedSet, frozenSet, allowOnSubmitSet, docstatus, isNew, canWriteLevel, user]);

  // Overlay the "updating…" flag on computed fields while a preview is in flight.
  const renderState = useMemo(() => {
    if (preview.status !== 'loading') return fieldState;
    const copy: FieldStateMap = { ...fieldState };
    for (const fn of computedSet) if (copy[fn]) copy[fn] = { ...copy[fn], updating: true };
    return copy;
  }, [fieldState, preview.status, computedSet]);

  // Merge preview results back into the form, matched by _row_id: top-level computed
  // fields and each child table's server-owned (read-only) cells, a refresh of
  // editable server-derived (`recompute`) cells so a derived display follows its
  // inputs, plus a live-fill of empty editable cells the server resolves
  // (price / fetch_from). A non-empty user entry (or an explicitly overridden derived
  // cell) is never overwritten, and concurrent add/remove/reorder during the debounce
  // is safe.
  useEffect(() => {
    if (!preview.data) return;
    const data = preview.data as Doc;
    for (const fn of computedSet) {
      form.setValue(fn, data[fn], { shouldDirty: false, shouldValidate: false });
    }
    for (const [tableField, spec] of tableMergeSets) {
      if (spec.owned.length === 0 && spec.derived.length === 0 && spec.fillable.length === 0)
        continue;
      const serverRows = data[tableField];
      const currentRows = form.getValues(tableField);
      if (!Array.isArray(serverRows) || !Array.isArray(currentRows)) continue;
      const merged = mergePreviewRows(currentRows as Doc[], serverRows as Doc[], spec);
      if (merged) form.setValue(tableField, merged, { shouldDirty: false, shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    const rhf = form.formState.errors as Record<string, { message?: string }>;
    for (const k of Object.keys(rhf)) {
      const m = rhf[k]?.message;
      if (m) out[k] = t(String(m));
    }
    return out;
  }, [form.formState.errors, t]);

  // Dirty-guard: block in-app navigation away from unsaved edits (data router).
  // `bypassGuardRef` lets a programmatic post-save/-delete navigation skip the guard.
  // It's essential (not merely a shortcut): form.reset() flips the dirty flag on RHF's
  // internal control synchronously, but the `formState.isDirty` value the blocker reads
  // is a render snapshot that only updates on the NEXT React render — which hasn't run
  // yet when we navigate in the same tick. Reading a ref at block-time sidesteps that
  // stale snapshot, so a successful save never false-triggers the discard prompt.
  const bypassGuardRef = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !bypassGuardRef.current &&
      form.formState.isDirty &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void dialog
      .confirm({
        title: tc('ui.record.discardTitle'),
        message: tc('ui.record.discardMessage'),
        confirmLabel: tc('ui.action.discard'),
        danger: true,
      })
      .then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // Native tab-close guard.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // preventDefault() alone triggers the browser's unsaved-changes prompt;
      // the legacy `returnValue` is deprecated.
      if (form.formState.isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [form.formState.isDirty]);

  const [serverMsgs, setServerMsgs] = useState<UiMessage[]>([]);
  // Optimistic concurrency: the `modified` we use as If-Match. Tracked in state (not
  // read off the frozen `initial` prop) so it advances after every successful save —
  // otherwise a second consecutive save would send a stale If-Match and 409.
  const [baseModified, setBaseModified] = useState<string | undefined>(
    initial['modified'] ? String(initial['modified']) : undefined,
  );
  const [conflict, setConflict] = useState(false);
  const createM = useCreate<Doc>(entity);
  const updateM = useUpdate<Doc>(entity);
  const saving = createM.isPending || updateM.isPending;

  // Live re-sync (realtime): when a refetch brings a NEWER server version of an
  // existing record and the form is pristine, adopt it so an open (un-edited) view
  // stays current. Keyed on the server `modified` stamp (changes only on a real
  // update). Never for a new doc (its seed is recomputed each render) and never
  // while dirty — the user's unsaved edits always win until they save/discard.
  const liveModified = !isNew && initial['modified'] ? String(initial['modified']) : undefined;
  useEffect(() => {
    if (isNew || form.formState.isDirty) return;
    form.reset(initial);
    setBaseModified(initial['modified'] ? String(initial['modified']) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveModified]);

  /** Reload the server's latest version after a concurrency clash, discarding local
   *  edits (confirmed first). Resets the form + the If-Match base so the next save
   *  builds on the fresh version. */
  const reloadLatest = async () => {
    const ok = await dialog.confirm({
      title: tc('ui.record.conflictTitle'),
      message: tc('ui.record.conflictReloadMessage'),
      confirmLabel: tc('ui.record.reloadLatest'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = isSingle ? await getSingle<Doc>(entity) : await getDoc<Doc>(entity, name!);
      const fresh = unwrap(res) as Doc;
      qc.setQueryData(isSingle ? qk.single(entity) : qk.doc(entity, name!), fresh);
      form.reset(fresh);
      setBaseModified(fresh['modified'] ? String(fresh['modified']) : undefined);
      setConflict(false);
      setServerMsgs([]);
    } catch (e) {
      setServerMsgs(toUiMessages(e, t));
    }
  };

  const onFieldChange = (fieldname: string, value: unknown) => {
    form.setValue(fieldname, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
    if (hasTable) preview.trigger({ ...form.getValues(), [fieldname]: value });
    // Live-resolve declarative fetch_from: when a Link source changes, fill
    // EMPTY top-level targets from the picked record (server resolves on save
    // too — this just unblocks required fields in the form).
    const targets = resolveFetchFromTargets(meta, fieldname);
    if (targets.length && typeof value === 'string' && value) {
      const src = meta.fields.find((f) => f.fieldname === fieldname);
      if (src?.target) {
        void getDoc(src.target, value).then((res) => {
          const rec = unwrap(res) as Record<string, unknown>;
          for (const { target, sourcePath } of targets) {
            const cur = form.getValues(target);
            if (cur == null || cur === '') {
              const v = sourcePath
                .split('.')
                .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), rec);
              if (v != null && v !== '') {
                form.setValue(target, v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
              }
            }
          }
        }).catch(() => {});
      }
    }
  };

  const submit = form.handleSubmit(async (values) => {
    if (conflict) return; // an edit conflict blocks re-save (incl. the Enter key) until reload
    setServerMsgs([]);
    // Confirm every save (consistent app-wide) — after validation has passed.
    const ok = await dialog.confirm({
      title: tc('ui.action.confirmSaveTitle'),
      message: tc('ui.action.confirmSaveBody'),
      confirmLabel: isNew ? tc('ui.action.create') : tc('ui.action.save'),
    });
    if (!ok) return;
    const body = stripForSave(meta, values as Doc, isNew ? undefined : initial);
    try {
      if (isNew) {
        const created = await createM.mutateAsync(body);
        form.reset(created as Doc); // clear dirty state (real value; render snapshot lags)
        dialog.toast(tc('ui.record.created'), 'success');
        const id = (created as Doc)['_id'];
        if (typeof id === 'string') {
          bypassGuardRef.current = true; // this navigation is a successful save, not a discard
          navigate(`/${entity}/${encodeURIComponent(id)}`, { replace: true });
        }
      } else {
        const updated = (await updateM.mutateAsync({ name: name!, body, expectedModified: baseModified })) as Doc;
        form.reset(updated);
        setBaseModified(updated['modified'] ? String(updated['modified']) : undefined);
        setConflict(false);
        dialog.toast(tc('ui.record.saved'), 'success');
      }
    } catch (e) {
      // Optimistic-concurrency clash: the stored doc advanced since we loaded it.
      // Surface a distinct conflict banner + block re-save until the user reloads
      // (a blind retry would just 409 again, or silently clobber the other edit).
      if (e instanceof ApiClientError && e.status === 409) {
        setConflict(true);
        return;
      }
      const msgs = toUiMessages(e, t);
      setServerMsgs(msgs);
      // Bind field-scoped server errors to their control (E1: messages[].path); the
      // rest stay in the form-level summary. RHF clears these on re-validate.
      for (const m of msgs) {
        if (m.path) form.setError(m.path, { type: 'server', message: m.text });
      }
    }
  });

  const deleteM = useDeleteDoc(entity);
  // Post-submit read-only parity (engine: DocStatusEngine.validateEdit). Once a
  // submittable doc is submitted (1) or cancelled (2) the engine rejects every PUT,
  // so the whole form is read-only (the field sweep already locks each control) and
  // the UI must not offer Save. Delete stays only for a *cancelled* (2) doc — a
  // submitted (1) doc can't be deleted while it stands; cancel it first.
  const docLocked = !!meta.is_submittable && docstatus >= 1;
  const canDelete =
    hasEntityPermission(meta, user, 'delete') &&
    !isSingle &&
    !(meta.is_submittable && docstatus === 1);
  const onDelete = async () => {
    if (!name) return;
    setServerMsgs([]);
    try {
      await deleteM.mutateAsync(name);
      form.reset(form.getValues()); // drop dirty state (real value; render snapshot lags)
      dialog.toast(tc('ui.record.deleted'), 'success');
      bypassGuardRef.current = true; // this navigation follows a successful delete, not a discard
      navigate(`/${entity}`, { replace: true });
    } catch (e) {
      setServerMsgs(toUiMessages(e, t));
    }
  };

  const title = isNew
    ? `${tEntity(entity, meta.label ?? entity)} · ${tc('ui.record.new')}`
    : (meta.title_field && watched[meta.title_field]
        ? String(watched[meta.title_field])
        : (name ?? tEntity(entity, meta.label ?? entity)));

  // Publish the resolved title for the breadcrumb leaf; clear before the next route
  // (Breadcrumbs reads it on an exact entity+name match, else the raw :name).
  const publishTitle = useRecordTitle((s) => s.publish);
  const clearTitle = useRecordTitle((s) => s.clear);
  useLayoutEffect(() => {
    if (!isNew && name) publishTitle(entity, name, title);
    return () => clearTitle();
  }, [entity, name, title, isNew, publishTitle, clearTitle]);

  return (
    <form
      onSubmit={submit}
      {...tid.page(isSingle ? 'single' : 'record', entity)}
      data-component="record-form"
      className="w-full space-y-4 pb-24"
    >
      <header className="flex items-start justify-between border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-textMuted">{tEntity(entity, meta.label ?? entity)}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h1 font-display text-textMain">{title}</h1>
            {!isNew && <StatusBadge meta={meta} row={watched as Record<string, unknown>} size="md" />}
            {docLocked && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border bg-subtle px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-textMuted"
                {...tid.component('docstatus-badge')}
              >
                <Lock className="h-3 w-3" aria-hidden="true" />
                {docstatus === 2 ? tc('ui.record.readonlyCancelled') : tc('ui.record.readonlySubmitted')}
              </span>
            )}
          </div>
          {!isNew && <RecordKpis entity={entity} meta={meta} doc={watched as Record<string, unknown>} />}
        </div>
        {!isNew && (
          <div className="flex flex-wrap items-center gap-2">
            <PrintMenu meta={meta} doc={watched} />
            <ActionBar entity={entity} name={name!} disabled={form.formState.isDirty || saving} />
            <WorkflowBar
              entity={entity}
              meta={meta}
              name={name!}
              doc={watched}
              disabled={form.formState.isDirty || saving}
              onApplied={(d) => form.reset(d)}
            />
          </div>
        )}
      </header>

      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm"
        >
          <div>
            <p className="font-medium text-textMain">{tc('ui.record.conflictTitle')}</p>
            <p className="text-textMuted">{tc('ui.record.conflictMessage')}</p>
          </div>
          <Button type="button" variant="secondary" onClick={reloadLatest}>
            {tc('ui.record.reloadLatest')}
          </Button>
        </div>
      )}

      {serverMsgs.length > 0 && <FormErrorSummary messages={serverMsgs} />}

      {/* Link fields with context_view get a live side panel (metadata-driven,
          see ContextPanel). Single column when none is active. */}
      <div
        className={
          hasContext ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6' : undefined
        }
      >
        <FormRenderer
          entity={entity}
          fields={meta.fields}
          form={meta.form}
          doc={watched}
          fieldState={renderState}
          errors={errors}
          onFieldChange={onFieldChange}
        />
        {hasContext && <ContextPanel entity={entity} meta={meta} doc={watched} />}
      </div>

      <RecordActions
        saving={saving}
        isNew={isNew}
        canDelete={canDelete}
        hideSave={docLocked}
        saveDisabled={conflict}
        busy={saving || deleteM.isPending}
        onCancel={() => navigate(-1)}
        onDelete={onDelete}
      />
    </form>
  );
}
