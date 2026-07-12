import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getDoc,
  getSingle,
  createDoc,
  updateDoc,
  deleteDoc as deleteResource,
  submitDoc,
  cancelDoc,
  amendDoc,
  transitionDoc,
} from '@/services/resource';
import type { EntityDefinition } from '@digitaplatform/shared';
import { qk, qkPrefix } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { useSessionStore } from '@/stores/session';

type Doc = Record<string, unknown>;

/** Metadata-driven (NOT a hardcoded entity set): after writing an entity flagged
 *  reload_boot_on_write (Setting/BrandingSetting), narrow-re-apply /boot-derived
 *  state so branding/default_workspace update without a full bootstrap. */
function maybeRefreshBoot(qc: ReturnType<typeof useQueryClient>, doctype: string) {
  const meta = qc.getQueryData<EntityDefinition>(qk.meta(doctype));
  if (meta?.reload_boot_on_write) void useSessionStore.getState().refreshBranding();
}

/** Load one document. Create mode (no name) does NOT fetch. */
export function useDocument<T = Doc>(doctype: string | undefined, name: string | undefined) {
  return useQuery<T>({
    queryKey: doctype && name ? qk.doc(doctype, name) : ['resource', '__none__', 'doc'],
    enabled: !!doctype && !!name,
    staleTime: 0,
    queryFn: async () => unwrap(await getDoc<T>(doctype!, name!)),
  });
}

/** Load THE row of an is_single entity (engine resolves the _id). */
export function useSingle<T = Doc>(doctype: string | undefined) {
  return useQuery<T>({
    queryKey: doctype ? qk.single(doctype) : ['resource', '__none__', 'single'],
    enabled: !!doctype,
    staleTime: 0,
    queryFn: async () => unwrap(await getSingle<T>(doctype!)),
  });
}

export function useCreate<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Doc) => unwrap(await createDoc<T>(doctype, body)),
    onSuccess: (doc) => {
      const id = (doc as Doc)['_id'];
      if (typeof id === 'string') qc.setQueryData(qk.doc(doctype, id), doc);
      void qc.invalidateQueries({ queryKey: qkPrefix.lists(doctype) });
      maybeRefreshBoot(qc, doctype);
    },
  });
}

export interface UpdateVars {
  name: string;
  body: Doc;
  /** `modified` last seen → If-Match (optimistic concurrency). */
  expectedModified?: string;
}

export function useUpdate<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, body, expectedModified }: UpdateVars) =>
      unwrap(await updateDoc<T>(doctype, name, body, expectedModified)),
    onSuccess: (doc, vars) => {
      qc.setQueryData(qk.doc(doctype, vars.name), doc);
      void qc.invalidateQueries({ queryKey: qkPrefix.lists(doctype) });
      void qc.invalidateQueries({ queryKey: qk.actions(doctype, vars.name) });
      maybeRefreshBoot(qc, doctype);
    },
  });
}

export function useDeleteDoc(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      await deleteResource(doctype, name);
      return name;
    },
    onSuccess: (name) => {
      qc.removeQueries({ queryKey: qk.doc(doctype, name) });
      void qc.invalidateQueries({ queryKey: qkPrefix.lists(doctype) });
    },
  });
}

// ── Workflow lifecycle ──────────────────────────────────────────────
// submit/cancel/transition return the updated doc. They invalidate the WHOLE
// entity (lists + the doc + its available actions) since a status flip can ripple.
function lifecycleSuccess(qc: ReturnType<typeof useQueryClient>, doctype: string, name: string, doc: unknown) {
  qc.setQueryData(qk.doc(doctype, name), doc);
  void qc.invalidateQueries({ queryKey: qkPrefix.entity(doctype) });
}

export function useSubmit<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await submitDoc<T>(doctype, name)),
    onSuccess: (doc, name) => lifecycleSuccess(qc, doctype, name, doc),
  });
}

export function useCancel<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await cancelDoc<T>(doctype, name)),
    onSuccess: (doc, name) => lifecycleSuccess(qc, doctype, name, doc),
  });
}

export function useTransition<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, to }: { name: string; to: string }) =>
      unwrap(await transitionDoc<T>(doctype, name, to)),
    onSuccess: (doc, vars) => lifecycleSuccess(qc, doctype, vars.name, doc),
  });
}

/**
 * Amend a cancelled doc. Unlike submit/cancel/transition (which mutate the SAME
 * doc in place), amend CREATES a new draft with its own `_id` that links back via
 * `amended_from`. So we seed the NEW doc's cache under its id (mirroring useCreate)
 * and invalidate the whole entity (lists + the source doc's available actions) —
 * we must NOT overwrite the source doc's cache key with the new draft.
 */
export function useAmend<T = Doc>(doctype: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await amendDoc<T>(doctype, name)),
    onSuccess: (doc) => {
      const id = (doc as Doc)['_id'];
      if (typeof id === 'string') qc.setQueryData(qk.doc(doctype, id), doc);
      void qc.invalidateQueries({ queryKey: qkPrefix.entity(doctype) });
    },
  });
}
