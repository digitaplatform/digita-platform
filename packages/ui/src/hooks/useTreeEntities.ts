import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EntityDefinition } from '@digitaplatform/shared';
import { getEntityMeta } from '@/services/meta';
import { unwrap } from '@/lib/api-result';
import { localizeMeta } from '@/lib/localize-meta';
import { useMetaCatalog } from '@/hooks/useMeta';
import { useI18nStore } from '@/stores/i18n';

export interface TreeEntity {
  entity: string;
  label: string;
  meta: EntityDefinition;
}

/**
 * Every entity whose EntityDefinition declares a `tree` config — the data source
 * for the generic master-data Groups module. The catalog summary omits `tree`,
 * so this fans out to each entity's full meta (mirroring useJobTasks) and filters
 * on `!!m.tree`. Labels are localized reactively on the active locale. Purely
 * metadata-driven — no entity-specific code.
 */
export function useTreeEntities(): { entities: TreeEntity[]; isLoading: boolean } {
  const catalogQ = useMetaCatalog();
  const translations = useI18nStore((s) => s.translations);
  const metasQ = useQuery({
    queryKey: ['tree-entity-metas'],
    enabled: !!catalogQ.data,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const summaries = catalogQ.data ?? [];
      const metas = await Promise.all(
        summaries.map(async (e) => {
          try {
            return unwrap(await getEntityMeta(e.name));
          } catch {
            return null;
          }
        }),
      );
      return metas.filter((m): m is EntityDefinition => !!m && !!m.tree);
    },
  });

  const entities = useMemo(
    () =>
      (metasQ.data ?? [])
        .map((raw) => {
          const m = localizeMeta(raw, translations);
          return { entity: m.name, label: m.label ?? m.name, meta: m };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [metasQ.data, translations],
  );

  return { entities, isLoading: catalogQ.isLoading || metasQ.isLoading };
}
