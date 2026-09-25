import { api } from '@/services/api';
import type { ApiResponse } from '@digitaplatform/shared';

/**
 * Upload a file against an entity that declares a storage_path. The attachment
 * context (attached_to_entity) is REQUIRED by the engine; attached_to_name is
 * optional, so a file can be uploaded on a not-yet-saved doc (the file_url is
 * stored on the field and persisted with the doc). Context fields are appended
 * BEFORE the file part (the engine reads them off the multipart stream in order).
 */
export interface UploadedFile {
  _id: string;
  file_url: string;
  file_name: string;
}

export async function uploadFile(
  file: File,
  entity: string,
  opts?: { name?: string; field?: string },
): Promise<UploadedFile> {
  const form = new FormData();
  form.set('attached_to_entity', entity);
  if (opts?.name) form.set('attached_to_name', opts.name);
  if (opts?.field) form.set('attached_to_field', opts.field);
  form.set('file', file);

  const res = await api.upload<ApiResponse<UploadedFile>>('/api/v1/upload', form);
  if (!res.success || !res.data) throw new Error(res.error?.detail ?? 'Upload failed');
  return res.data;
}
