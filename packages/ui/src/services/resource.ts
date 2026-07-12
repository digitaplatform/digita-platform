import { api } from '@/services/api';
import type { ApiResponse, ActionDefinition, ViewResult } from '@digitaplatform/shared';

const RESOURCE = '/api/v1/resource';
type Doc = Record<string, unknown>;

export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  order_by?: string;
  /** AND conditions: [field, op, value][]. */
  filters?: [string, string, unknown][];
  /** OR conditions: [field, op, value][] (engine `or_filters`). */
  or_filters?: [string, string, unknown][];
  fields?: string[];
}

function enc(...parts: string[]): string {
  return parts.map(encodeURIComponent).join('/');
}

export function getList<T = Doc>(entity: string, params: ListParams = {}): Promise<ApiResponse<T[]>> {
  return api.get<ApiResponse<T[]>>(`${RESOURCE}/${enc(entity)}`, {
    page: params.page,
    page_size: params.page_size,
    search: params.search || undefined,
    order_by: params.order_by || undefined,
    filters: params.filters ? JSON.stringify(params.filters) : undefined,
    or_filters: params.or_filters ? JSON.stringify(params.or_filters) : undefined,
    fields: params.fields ? JSON.stringify(params.fields) : undefined,
  });
}

/** Execute a named View (composed by Workspace dashboard cards). Param values are
 *  scalars; a card needing an array/object param JSON-stringifies it first. */
export function getView(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<ApiResponse<ViewResult>> {
  return api.get<ApiResponse<ViewResult>>(`/api/v1/view/${enc(name)}`, params);
}

export function getDoc<T = Doc>(entity: string, name: string): Promise<ApiResponse<T>> {
  return api.get<ApiResponse<T>>(`${RESOURCE}/${enc(entity, name)}`);
}

/** The one row of an is_single entity (engine resolves the _id). 400 if not single, 404 if unseeded. */
export function getSingle<T = Doc>(entity: string): Promise<ApiResponse<T>> {
  return api.get<ApiResponse<T>>(`${RESOURCE}/${enc(entity)}/single`);
}

/** One typeahead result for a Link field. Sub-row results carry a composite
 *  `<parent>::<row_id>` _id + a parent-title subtitle. */
export interface LinkSearchResult {
  _id: string;
  display: string;
  subtitle?: string;
  /** Column values for the search-dialog picker (present when `fields` requested). */
  fields?: Record<string, unknown>;
}

/** Link-field typeahead. `targetPath` expands the search into sub-rows; `fields`
 *  requests extra column values per row for the search-dialog picker. */
export function searchLinks(
  entity: string,
  params: {
    q: string;
    limit?: number;
    targetPath?: string;
    filters?: Record<string, unknown>;
    fields?: string[];
  },
): Promise<ApiResponse<LinkSearchResult[]>> {
  return api.get<ApiResponse<LinkSearchResult[]>>(`/api/v1/search/${enc(entity)}`, {
    q: params.q,
    limit: params.limit,
    target_path: params.targetPath,
    filters: params.filters ? JSON.stringify(params.filters) : undefined,
    fields: params.fields && params.fields.length > 0 ? params.fields.join(',') : undefined,
  });
}

export function createDoc<T = Doc>(entity: string, body: Doc): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity)}`, body);
}

export function updateDoc<T = Doc>(
  entity: string,
  name: string,
  body: Doc,
  /** Optimistic concurrency: the `modified` the client last saw → sent as If-Match.
   *  The engine 409s (CONCURRENT_MODIFICATION) if the stored doc has advanced since. */
  expectedModified?: string,
): Promise<ApiResponse<T>> {
  return api.put<ApiResponse<T>>(
    `${RESOURCE}/${enc(entity, name)}`,
    body,
    expectedModified ? { 'If-Match': expectedModified } : undefined,
  );
}

export function deleteDoc(entity: string, name: string): Promise<ApiResponse<null>> {
  return api.del<ApiResponse<null>>(`${RESOURCE}/${enc(entity, name)}`);
}

export function submitDoc<T = Doc>(entity: string, name: string): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity, name)}/submit`, {});
}

export function cancelDoc<T = Doc>(entity: string, name: string): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity, name)}/cancel`, {});
}

/** Amend a cancelled (docstatus-2) doc: the engine creates a fresh EDITABLE DRAFT
 *  that links back to the source via `amended_from` and returns that NEW doc (201).
 *  The caller navigates to the returned doc's `_id` (a different id than the source). */
export function amendDoc<T = Doc>(entity: string, name: string): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity, name)}/amend`, {});
}

export function transitionDoc<T = Doc>(entity: string, name: string, to: string): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity, name)}/transition`, { to });
}

/** Actions available on this doc (entity.actions filtered by show_if + permission). */
export function getActions(entity: string, name: string): Promise<ApiResponse<ActionDefinition[]>> {
  return api.get<ApiResponse<ActionDefinition[]>>(`${RESOURCE}/${enc(entity, name)}/actions`);
}

/** Result of an action handler: `result` is the handler's return (e.g.
 *  `{ created: { entity, name } }`); `dialog_data` echoes the posted dialog fields.
 *  Recognized result shapes beyond `created`:
 *  - `download` → the client saves the payload as a file (e.g. XRechnung XML)
 *  - `open_url` → the client opens the URL in a new tab
 *  - legacy `{ xml, filename }` (generateXRechnung) is normalized to `download`. */
export interface ActionResult {
  result: {
    created?: { entity: string; name: string };
    download?: { filename: string; content_base64?: string; content?: string; mime_type?: string };
    open_url?: string;
    xml?: string;
    filename?: string;
  } & Record<string, unknown>;
  dialog_data: Record<string, unknown>;
}

/** Invoke an action handler (POST .../action/:action) with optional dialog data. */
export function runAction(
  entity: string,
  name: string,
  action: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse<ActionResult>> {
  return api.post<ApiResponse<ActionResult>>(
    `${RESOURCE}/${enc(entity, name)}/action/${encodeURIComponent(action)}`,
    body ?? {},
  );
}

/** Run computed hooks against a draft doc WITHOUT persisting (generic preview).
 *  A draft has no name yet — the engine route is POST /resource/:entity/preview. */
export function previewDoc<T = Doc>(entity: string, body: Doc): Promise<ApiResponse<T>> {
  return api.post<ApiResponse<T>>(`${RESOURCE}/${enc(entity)}/preview`, body);
}
