import type { ApiResponse, ImportReport, ImportRequestBody } from '@digitaplatform/shared';
import { api } from './api';

/**
 * Master-data import. Posts a JSON `rows` array or a `csv` string to the engine's
 * generic import endpoint; the server owns parsing, business-key resolution and
 * the full write pipeline. `mode: 'validate'` is a dry run (no writes).
 */
export function importRows(entity: string, body: ImportRequestBody): Promise<ApiResponse<ImportReport>> {
  return api.post<ApiResponse<ImportReport>>(`/api/v1/import/${encodeURIComponent(entity)}`, body);
}
