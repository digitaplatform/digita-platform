import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';
import type { PluginManifest } from '@digitaplatform/plugins';

/** The app's plugin composition, GET /api/v1/plugins, through the api client (session
 *  cookie, refresh on 401). The contract and its join with the inventory live in
 *  @digitaplatform/plugins. */
export function getPluginManifest(): Promise<ApiResponse<PluginManifest>> {
  return api.get<ApiResponse<PluginManifest>>('/api/v1/plugins');
}
