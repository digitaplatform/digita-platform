import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';
import type { PluginManifestEntry, LayoutConfig } from '@digitaplatform/plugins';

/** What the engine serves for this app: which plugins to load + their opaque
 *  placement layout (both from the app's plugins.config.json). The engine does
 *  not interpret the layout — the host applies it. */
export interface PluginManifest {
  plugins: PluginManifestEntry[];
  layout?: LayoutConfig;
}

export function getPluginManifest(): Promise<ApiResponse<PluginManifest>> {
  return api.get<ApiResponse<PluginManifest>>('/api/v1/plugins');
}
