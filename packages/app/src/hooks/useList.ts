import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getList, type ListParams } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { normalizeListParams } from '@/lib/filter-from-url';

export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Paginated list for any entity. An empty result is a valid `rows: []` (NOT a
 * fail-loud — we never call unwrap on the list). Missing pagination meta IS a
 * loud failure: fabricating `total = rows.length` would mask a contract break.
 * `keepPreviousData` avoids a flash on page/filter changes.
 * Tree readers use allPages to publish a complete forest, with no partial or previous-query rows.
 */
export function useList<T = Record<string, unknown>>(
  doctype: string | undefined,
  params: ListParams,
  options: { allPages?: boolean } = {},
) {
  const norm = normalizeListParams(params);
  const allPages = options.allPages === true;
  const key = doctype ? qk.list(doctype, norm) : ['resource', '__none__', 'list'];
  return useQuery<ListResult<T>>({
    queryKey: allPages ? [...key, 'all-pages'] : key,
    enabled: !!doctype,
    placeholderData: allPages ? undefined : keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => {
      const rows: T[] = [];
      for (let page = 1; ; page++) {
        const res = await getList<T>(doctype!, allPages ? { ...norm, page, order_by: '_id asc' } : norm);
        if (!res.meta) {
          if (import.meta.env.DEV) console.error('[useList] response is missing pagination meta', res);
          throw new Error('list_response_missing_meta');
        }
        rows.push(...(res.data ?? []));
        if (!allPages || page >= res.meta.total_pages) {
          return {
            rows,
            total: res.meta.total,
            page: allPages ? 1 : res.meta.page,
            pageSize: allPages ? Math.max(1, rows.length) : res.meta.page_size,
            totalPages: allPages ? (rows.length ? 1 : 0) : res.meta.total_pages,
          };
        }
      }
    },
  });
}
