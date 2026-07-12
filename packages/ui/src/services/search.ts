import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';

/** One global-search hit. The engine result carries the doctype + business key +
 *  a display label; typed permissively (shape confirmed at integration). */
export interface GlobalSearchResult {
  entity?: string;
  doctype?: string;
  name?: string;
  _id?: string;
  title?: string;
  display?: string;
  [k: string]: unknown;
}

/** Global record search (GET /api/v1/search). The engine returns [] for q < 2. */
export function globalSearch(q: string, limit = 20): Promise<ApiResponse<GlobalSearchResult[]>> {
  return api.get<ApiResponse<GlobalSearchResult[]>>('/api/v1/search', { q, limit });
}
