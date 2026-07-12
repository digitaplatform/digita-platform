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
 */
export function useList<T = Record<string, unknown>>(doctype: string | undefined, params: ListParams) {
  const norm = normalizeListParams(params);
  return useQuery<ListResult<T>>({
    queryKey: doctype ? qk.list(doctype, norm) : ['resource', '__none__', 'list'],
    enabled: !!doctype,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    queryFn: async () => {
      const res = await getList<T>(doctype!, norm);
      const rows = (res.data ?? []) as T[];
      if (!res.meta) {
        if (import.meta.env.DEV) console.error('[useList] response is missing pagination meta', res);
        throw new Error('list_response_missing_meta');
      }
      return {
        rows,
        total: res.meta.total,
        page: res.meta.page,
        pageSize: res.meta.page_size,
        totalPages: res.meta.total_pages,
      };
    },
  });
}
