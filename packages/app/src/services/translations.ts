import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';

/** All translations for a locale — hierarchical keys (entity.X / field.X.f /
 *  option.X.f.v / system.*). Fetched once per locale. */
export function getTranslations(locale: string): Promise<ApiResponse<Record<string, string>>> {
  return api.get<ApiResponse<Record<string, string>>>(
    `/api/v1/translations/${encodeURIComponent(locale)}`,
  );
}
