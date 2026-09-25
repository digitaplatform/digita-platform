import { useQuery } from '@tanstack/react-query';
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
}) {
  const q = params.q.trim();
  const enabled = (params.enabled ?? true) && !!params.entity;
  return useQuery<LinkSearchResult[]>({
    queryKey: qk.search(params.entity ?? '', q, {
      tp: params.targetPath ?? null,
      f: params.filters ?? null,
      c: params.fields ?? null,
    }),
    enabled,
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
