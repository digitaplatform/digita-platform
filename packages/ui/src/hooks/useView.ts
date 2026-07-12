import { useQuery } from '@tanstack/react-query';
import type { ViewResult, ResponseMessage } from '@digitaplatform/shared';
import { getView } from '@/services/resource';
import { qk } from '@/lib/query-keys';
import { ApiClientError } from '@/lib/errors';

export interface ViewQueryData {
  result: ViewResult | null;
  messages: ResponseMessage[];
}

/**
 * Execute a named View for dashboard cards. Throws ONLY on a whole-view failure
 * (success:false — anchored-required / bad param / 404 root). Section soft-fails
 * stay success:true with messages[] (path `/sections/<key>`), so each card maps
 * its section to a calm locked/empty state.
 */
export function useView(name: string | undefined, params?: Record<string, string | number | boolean>) {
  return useQuery<ViewQueryData>({
    queryKey: qk.view(name ?? '', params ?? null),
    enabled: !!name,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await getView(name!, params);
      if (!res.success) {
        throw new ApiClientError(res.error?.detail ?? 'View failed', res.status_code ?? 500, res);
      }
      return { result: res.data, messages: res.messages ?? [] };
    },
  });
}
