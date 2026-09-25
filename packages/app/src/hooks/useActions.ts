import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionDefinition } from '@digitaplatform/shared';
import { getActions, runAction, type ActionResult } from '@/services/resource';
import { qk, qkPrefix } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { useI18nStore } from '@/stores/i18n';

/** The actions the engine reports as available on this doc (already filtered by
 *  show_if + requires_permission server-side). Action labels are localized via
 *  the generic `action.{Entity}.{action}` key (fallback: the raw meta label). */
export function useActions(entity: string | undefined, name: string | undefined) {
  const query = useQuery<ActionDefinition[]>({
    queryKey: entity && name ? qk.actions(entity, name) : ['resource', '__none__', 'actions'],
    enabled: !!entity && !!name,
    staleTime: 10_000,
    queryFn: async () => (await getActions(entity!, name!)).data ?? [],
  });
  const translations = useI18nStore((s) => s.translations);
  const data = useMemo(
    () =>
      query.data && entity
        ? query.data.map((a) => ({ ...a, label: translations[`action.${entity}.${a.action}`] ?? a.label }))
        : query.data,
    [query.data, translations, entity],
  );
  return { ...query, data };
}

export function useRunAction(entity: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; action: string; body?: Record<string, unknown> }): Promise<ActionResult> =>
      unwrap(await runAction(entity, vars.name, vars.action, vars.body)),
    onSuccess: (_res, vars) => {
      // An action can mutate the source doc + spawn others — invalidate broadly.
      void qc.invalidateQueries({ queryKey: qkPrefix.entity(entity) });
      void qc.invalidateQueries({ queryKey: qk.doc(entity, vars.name) });
    },
  });
}
