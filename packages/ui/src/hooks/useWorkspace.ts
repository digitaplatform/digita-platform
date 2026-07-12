import { useQuery } from '@tanstack/react-query';
import type { WorkspaceDoc } from '@digitaplatform/shared';
import { getDoc } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';
import { validateWorkspaceCards } from '@/lib/workspace-schema';

/** One workspace doc, with its cards validated fail-loud (throws workspace_cards_invalid). */
export function useWorkspace(id: string | undefined) {
  return useQuery<WorkspaceDoc>({
    queryKey: id ? qk.workspace(id) : ['workspace', '__none__'],
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const doc = unwrap(await getDoc<WorkspaceDoc>('Workspace', id!));
      doc.cards = validateWorkspaceCards(doc.cards);
      return doc;
    },
  });
}
