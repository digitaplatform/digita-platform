import { useMemo, useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { EntityDefinition } from '@digitaplatform/shared';
import { BaseDialog, Button, FormSkeleton } from '@digitaplatform/components';
import { useDocument, useCreate, useUpdate } from '@/hooks/useDocument';
import { buildZodSchema } from '@/lib/schema-from-meta';
import {
  sweepFieldStates,
  deriveComputedSet,
  deriveFrozenSet,
  deriveAllowOnSubmitSet,
  type FieldStateMap,
} from '@/lib/evaluate-field';
import { writableLevelPredicate } from '@/lib/permissions';
import { FormRenderer } from '@/components/render/FormRenderer';
import { stripForSave } from '@/pages/RecordPage';
import { ErrorBlock, FormErrorSummary } from '@/components/status';
import { useSessionStore } from '@/stores/session';
import { useI18nStore } from '@/stores/i18n';
import { useChrome } from '@/lib/chrome-i18n';
import { toUiMessages, type UiMessage } from '@/lib/api-result';
import { ApiClientError } from '@/lib/errors';

type Doc = Record<string, unknown>;

/** New-record seed: field defaults merged under caller pre-fills (e.g. a tree
 *  node's parent + group partition). Mirrors RecordPage.buildSeed + a seed. */
function buildSeed(meta: EntityDefinition, seed?: Doc): Doc {
  const out: Doc = { docstatus: 0 };
  for (const f of meta.fields) {
    if (f.default === undefined) continue;
    if (f.fieldtype === 'Date' && f.default === '__today__') {
      out[f.fieldname] = new Date().toISOString().slice(0, 10);
    } else {
      out[f.fieldname] = f.default;
    }
  }
  return { ...out, ...(seed ?? {}) };
}

interface RecordDialogProps {
  open: boolean;
  onClose: () => void;
  entity: string;
  meta: EntityDefinition;
  /** Existing record id to edit; omit for a NEW record. */
  name?: string;
  /** Field pre-fills for a NEW record (parent/group in a tree). */
  seed?: Doc;
  /** Ancestor labels root→parent, rendered as a breadcrumb so the operator sees
   *  where the node sits (e.g. Electronics › Phones). */
  ancestry?: string[];
  /** Called with the saved doc AFTER a successful create/update (before close). */
  onSaved?: (doc: Doc) => void;
}

/**
 * Edit (or create) ONE record's fields in a modal instead of navigating to the
 * full record page — so a tree/list stays in view behind it. Reuses the same
 * form stack as RecordPage (metadata FormRenderer + field-state sweep + zod
 * validation + optimistic-concurrency save), minus the page chrome (no workflow
 * bar / KPIs / child-table preview) — it targets simple records like master-data
 * groups. Generic: edits whatever entity + fields it is handed.
 */
export function RecordDialog({
  open,
  onClose,
  entity,
  meta,
  name,
  seed,
  ancestry,
  onSaved,
}: RecordDialogProps) {
  const isNew = !name;
  const tc = useChrome();
  const tEntity = useI18nStore((s) => s.tEntity);

  const docQ = useDocument<Doc>(isNew ? undefined : entity, isNew ? undefined : name);
  const initial: Doc | null = isNew ? buildSeed(meta, seed) : (docQ.data ?? null);

  const title = isNew
    ? `${tEntity(entity, meta.label ?? entity)} · ${tc('ui.record.new')}`
    : meta.title_field && initial?.[meta.title_field]
      ? String(initial[meta.title_field])
      : (name ?? tEntity(entity, meta.label ?? entity));

  return (
    <BaseDialog open={open} onClose={onClose} title={title} size="xl">
      {ancestry && ancestry.length > 0 && (
        <nav
          aria-label="ancestry"
          className="mb-4 flex flex-wrap items-center gap-1 text-xs text-textMuted"
        >
          {ancestry.map((label, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-borderStrong">›</span>}
              <span>{label}</span>
            </span>
          ))}
        </nav>
      )}

      {!isNew && docQ.isLoading ? (
        <FormSkeleton fields={5} />
      ) : !isNew && docQ.isError ? (
        <ErrorBlock
          title={tc('ui.record.loadFailed')}
          detail={docQ.error instanceof Error ? docQ.error.message : String(docQ.error)}
        />
      ) : initial ? (
        <RecordDialogForm
          key={name ?? 'new'}
          entity={entity}
          meta={meta}
          initial={initial}
          isNew={isNew}
          name={name}
          onSaved={onSaved}
          onClose={onClose}
        />
      ) : (
        <FormSkeleton fields={5} />
      )}
    </BaseDialog>
  );
}

function RecordDialogForm({
  entity,
  meta,
  initial,
  isNew,
  name,
  onSaved,
  onClose,
}: {
  entity: string;
  meta: EntityDefinition;
  initial: Doc;
  isNew: boolean;
  name?: string;
  onSaved?: (doc: Doc) => void;
  onClose: () => void;
}) {
  const user = useSessionStore((s) => s.user);
  const t = useI18nStore((s) => s.t);
  const tc = useChrome();

  const computedSet = useMemo(() => deriveComputedSet(meta), [meta]);
  const frozenSet = useMemo(() => deriveFrozenSet(meta), [meta]);
  const allowOnSubmitSet = useMemo(() => deriveAllowOnSubmitSet(meta), [meta]);
  const canWriteLevel = useMemo(() => writableLevelPredicate(meta, user), [meta, user]);

  const stateRef = useRef<FieldStateMap>({});
  const requiredResolver = useRef((fn: string) => stateRef.current[fn]?.required ?? false).current;
  const schema = useMemo(() => buildZodSchema(meta, requiredResolver), [meta, requiredResolver]);
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

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    const rhf = form.formState.errors as Record<string, { message?: string }>;
    for (const k of Object.keys(rhf)) {
      const m = rhf[k]?.message;
      if (m) out[k] = t(String(m));
    }
    return out;
  }, [form.formState.errors, t]);

  const [serverMsgs, setServerMsgs] = useState<UiMessage[]>([]);
  const [conflict, setConflict] = useState(false);
  const [baseModified, setBaseModified] = useState<string | undefined>(
    initial['modified'] ? String(initial['modified']) : undefined,
  );
  const createM = useCreate<Doc>(entity);
  const updateM = useUpdate<Doc>(entity);
  const saving = createM.isPending || updateM.isPending;

  const onFieldChange = (fieldname: string, value: unknown) => {
    form.setValue(fieldname, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  const submit = form.handleSubmit(async (values) => {
    if (conflict) return;
    setServerMsgs([]);
    const body = stripForSave(meta, values as Doc, isNew ? undefined : initial);
    try {
      if (isNew) {
        const created = (await createM.mutateAsync(body)) as Doc;
        onSaved?.(created);
        onClose();
      } else {
        const updated = (await updateM.mutateAsync({
          name: name!,
          body,
          expectedModified: baseModified,
        })) as Doc;
        setBaseModified(updated['modified'] ? String(updated['modified']) : undefined);
        onSaved?.(updated);
        onClose();
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        setConflict(true);
        return;
      }
      const msgs = toUiMessages(e, t);
      setServerMsgs(msgs);
      for (const m of msgs) if (m.path) form.setError(m.path, { type: 'server', message: m.text });
    }
  });

  return (
    <form onSubmit={submit} data-component="record-dialog-form" className="space-y-4">
      {conflict && (
        <div role="alert" className="rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm">
          <p className="font-medium text-textMain">{tc('ui.record.conflictTitle')}</p>
          <p className="text-textMuted">{tc('ui.record.conflictReloadMessage')}</p>
        </div>
      )}
      {serverMsgs.length > 0 && <FormErrorSummary messages={serverMsgs} />}

      <FormRenderer
        entity={entity}
        fields={meta.fields}
        form={meta.form}
        doc={watched}
        fieldState={fieldState}
        errors={errors}
        onFieldChange={onFieldChange}
      />

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {tc('ui.action.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={conflict}>
          {isNew ? tc('ui.action.create') : tc('ui.action.save')}
        </Button>
      </div>
    </form>
  );
}
