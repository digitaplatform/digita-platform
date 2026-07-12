import { api } from '@/services/api';
import type { ApiResponse, EntityDefinition } from '@digitaplatform/shared';
import type { EntitySummary } from '@/types';

/** The whole entity catalog — drives the meta-derived nav baseline + entity routing. */
export function getEntityCatalog(): Promise<ApiResponse<EntitySummary[]>> {
  return api.get<ApiResponse<EntitySummary[]>>('/api/v1/meta');
}

/** Full definition for one entity — drives the generic list + form renderers. */
export function getEntityMeta(doctype: string): Promise<ApiResponse<EntityDefinition>> {
  return api.get<ApiResponse<EntityDefinition>>(`/api/v1/meta/${encodeURIComponent(doctype)}`);
}
