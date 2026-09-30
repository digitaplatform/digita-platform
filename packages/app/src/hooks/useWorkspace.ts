import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkspaceDoc } from '@digitaplatform/shared';
import { getDoc } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { validateWorkspaceCards } from '@/lib/workspace-schema';
import { useI18nStore } from '@/stores/i18n';
import { localizeWorkspace } from '@/lib/localize-meta';

/** One workspace doc, with its cards validated fail-loud (throws workspace_cards_invalid)
 *  and its texts localized, reactive on the active locale. */
export function useWorkspace(id: string | undefined) {
  const query = useQuery<WorkspaceDoc>({
    queryKey: id ? qk.workspace(id) : ['workspace', '__none__'],
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const doc = unwrap(await getDoc<WorkspaceDoc>('Workspace', id!));
      doc.cards = validateWorkspaceCards(doc.cards);
      return doc;
    },
  });
  const translations = useI18nStore((s) => s.translations);
  const data = useMemo(
    () => (query.data ? localizeWorkspace(query.data, translations) : query.data),
    [query.data, translations],
  );
  return { ...query, data };
}
