import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';
import { getEntityMeta, getEntityCatalog } from '@/services/meta';
import { qk, qkPrefix } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { useI18nStore } from '@/stores/i18n';
import { localizeMeta, localizeSummary } from '@/lib/localize-meta';

// Meta is stable within a session but NOT immutable — a 30-min window auto-recovers
// after an engine restart/redeploy (NOT Infinity, which would strand a stale schema).
// useRefreshMeta() forces it instantly (the F5 "refresh meta" escape hatch).
const META_STALE = 30 * 60 * 1000;
const META_GC = 60 * 60 * 1000;

/** Full EntityDefinition for one doctype — drives the list + form renderers.
 *  Meta is localized at this seam (generic `localizeMeta`), reactive on locale,
 *  so every renderer reads already-translated labels/sections/descriptions/actions. */
export function useMeta(doctype?: string) {
  const query = useQuery<EntityDefinition>({
    queryKey: qk.meta(doctype ?? ''),
    queryFn: async () => unwrap(await getEntityMeta(doctype!)),
    enabled: !!doctype,
    staleTime: META_STALE,
    gcTime: META_GC,
  });
  const translations = useI18nStore((s) => s.translations);
  const data = useMemo(
    () => (query.data ? localizeMeta(query.data, translations) : query.data),
    [query.data, translations],
  );
  return { ...query, data };
}

/** The whole entity catalog (summaries) — entity routing + the meta-derived
 *  baseline. Summaries are localized (entity singular + plural) at this seam. */
export function useMetaCatalog() {
  const query = useQuery<EntitySummary[]>({
    queryKey: qk.metaCatalog(),
    queryFn: async () => unwrap(await getEntityCatalog()),
    staleTime: META_STALE,
    gcTime: META_GC,
  });
  const translations = useI18nStore((s) => s.translations);
  const data = useMemo(
    () => (query.data ? query.data.map((s) => localizeSummary(s, translations)) : query.data),
    [query.data, translations],
  );
  return { ...query, data };
}

/** Force a meta refetch (catalog + every per-entity definition). */
export function useRefreshMeta(): () => Promise<void> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qkPrefix.allMeta() });
}
