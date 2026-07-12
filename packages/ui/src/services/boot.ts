import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';
import type { BootData } from '@/types';

/** One-call bootstrap: session user, locale, languages, settings — and (once the
 *  /boot extension lands) the resolved nav, branding, and default workspace. */
export function getBoot(): Promise<ApiResponse<BootData>> {
  return api.get<ApiResponse<BootData>>('/api/v1/boot');
}
