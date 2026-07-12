import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  type ListPreferenceDoc,
} from '@/services/listPreference';
import { qk, qkPrefix } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { useSessionStore } from '@/stores/session';

const truthy = (v: unknown) => v === 1 || v === true;

/**
 * Saved views for an entity. The engine read is broad (so shared views are
 * visible); this hook applies the precise visibility rule — a view is visible
 * when it's mine, shared with everyone, or shared with one of my roles / my
 * email. Write/delete are owner-only server-side; `canEdit` mirrors that for the
 * UI. `defaultView` resolves my default first, then the org default.
 */
export function useListPreferences(entity: string | undefined) {
  const qc = useQueryClient();
  const mine = useSessionStore((s) => s.user?.email);
  const myRoles = useSessionStore((s) => s.user?.roles);
  const isAdmin = useSessionStore((s) => s.hasRole('Administrator'));

  const query = useQuery<ListPreferenceDoc[]>({
    queryKey: entity ? qk.listPreferences(entity) : ['listPreferences', '__none__'],
    enabled: !!entity,
    staleTime: 60_000,
    queryFn: async () => unwrap(await listSavedViews(entity!)),
  });

  const visibleToMe = (v: ListPreferenceDoc): boolean => {
    if (v.owner === mine) return true;
    if (v.visibility === 'everyone') return true;
    if (v.visibility === 'shared') {
      const roles = v.shared_with_roles ?? [];
      const users = v.shared_with_users ?? [];
      return roles.some((r) => (myRoles ?? []).includes(r)) || (!!mine && users.includes(mine));
    }
    return false;
  };

  const views = useMemo(
    () => (query.data ?? []).filter(visibleToMe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, mine, myRoles],
  );

  const canEdit = (v: ListPreferenceDoc): boolean => v.owner === mine || isAdmin;

  /** My default for this entity, else the org default — the view to auto-apply on bare entry. */
  const defaultView = useMemo(
    () =>
      views.find((v) => truthy(v.is_default) && v.owner === mine) ??
      views.find((v) => truthy(v.is_org_default)),
    [views, mine],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: qkPrefix.listPreferences(entity ?? '') });

  const create = useMutation({
    mutationFn: async (body: Partial<ListPreferenceDoc>) => unwrap(await createSavedView({ ...body, entity })),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async (vars: { id: string; body: Partial<ListPreferenceDoc> }) =>
      unwrap(await updateSavedView(vars.id, vars.body)),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteSavedView(id);
      return id;
    },
    onSuccess: invalidate,
  });

  /** Client-enforced: at most one MY-default per (owner, entity). */
  const setDefault = async (id: string) => {
    const prev = (query.data ?? []).filter(
      (v) => truthy(v.is_default) && v.owner === mine && v._id !== id,
    );
    for (const p of prev) await updateSavedView(p._id, { is_default: 0 });
    await updateSavedView(id, { is_default: 1 });
    invalidate();
  };

  /** Admin: at most one ORG-default per entity. */
  const setOrgDefault = async (id: string) => {
    const prev = (query.data ?? []).filter((v) => truthy(v.is_org_default) && v._id !== id);
    for (const p of prev) await updateSavedView(p._id, { is_org_default: 0 });
    await updateSavedView(id, { is_org_default: 1 });
    invalidate();
  };

  return { ...query, views, canEdit, isAdmin, defaultView, create, update, remove, setDefault, setOrgDefault };
}
