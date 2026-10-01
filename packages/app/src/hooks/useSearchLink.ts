import { useQuery, hashKey } from '@tanstack/react-query';
import { searchLinks, type LinkSearchResult } from '@/services/resource';
import { qk } from '@/lib/query-keys';

/** Typeahead query for Link fields. The engine link-search endpoint accepts an
 *  EMPTY query (returns the first N rows), so the dropdown can open and show
 *  options immediately and then filter as the user types — no minimum length.
 *  The control debounces the query it passes in. */
export function useSearchLink(params: {
  entity?: string;
  q: string;
  targetPath?: string;
  filters?: Record<string, unknown>;
  /** Extra column values to fetch per row (search-dialog picker). */
  fields?: string[];
  limit?: number;
  enabled?: boolean;
  /** While the answer to a new search text is on its way, `data` keeps the rows of the previous
   *  text and `isPlaceholderData` is true, so a picker dialog never empties between two answers. */
  keepPreviousRows?: boolean;
}) {
  const q = params.q.trim();
  const enabled = (params.enabled ?? true) && !!params.entity;
  const entity = params.entity ?? '';
  const scope = { tp: params.targetPath ?? null, f: params.filters ?? null, c: params.fields ?? null };
  return useQuery<LinkSearchResult[]>({
    queryKey: qk.search(entity, q, scope),
    enabled,
    // Rows stand in only for another text of the same search. Another entity, target path, filter or
    // column set asks another question, and its rows (the customers of another company, for example)
    // are not on offer here.
    placeholderData: params.keepPreviousRows
      ? (previousRows, previousQuery) => {
          const [, previousEntity, , previousScope] = previousQuery?.queryKey ?? [];
          return previousEntity === entity && hashKey([previousScope]) === hashKey([scope]) ? previousRows : undefined;
        }
      : undefined,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await searchLinks(params.entity!, {
        q,
        limit: params.limit,
        targetPath: params.targetPath,
        filters: params.filters,
        fields: params.fields,
      });
      return res.data ?? [];
    },
  });
}
