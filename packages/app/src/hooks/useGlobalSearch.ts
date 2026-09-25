import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { globalSearch, type GlobalSearchResult } from '@/services/search';
import { qk } from '@/lib/query-keys';
import { unwrap } from '@/lib/api-result';

/** Global record search for the command palette (enabled at >= 2 chars). A 500
 *  (e.g. ReDoS-rejected) throws → the palette shows an inline error, never a
 *  silent empty list. */
export function useGlobalSearch(q: string) {
  const query = q.trim();
  return useQuery<GlobalSearchResult[]>({
    queryKey: qk.globalSearch(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => unwrap(await globalSearch(query)),
  });
}
