import { getList, createDoc, updateDoc, deleteDoc } from '@/services/resource';

export type ViewVisibility = 'private' | 'shared' | 'everyone';

/** A saved list view (ListPreference entity). owner is stamped server-side. */
export interface ListPreferenceDoc {
  _id: string;
  view_name: string;
  entity: string;
  owner?: string;
  owner_name?: string;
  /** private (owner only) | shared (roles/users below) | everyone. */
  visibility?: ViewVisibility;
  shared_with_roles?: string[] | null;
  shared_with_users?: string[] | null;
  /** The owner's auto-applied default for this entity. */
  is_default?: boolean | number;
  /** An Administrator-set fallback default for users with no default of their own. */
  is_org_default?: boolean | number;
  filters?: [string, string, unknown][];
  or_filters?: [string, string, unknown][];
  order_by?: string;
  columns?: string[] | null;
  page_size?: number;
}

/** All saved views for an entity. The engine returns the rows the user may read
 *  (own + shared); the hook applies the precise visibility filter. */
export function listSavedViews(entity: string) {
  return getList<ListPreferenceDoc>('ListPreference', {
    filters: [['entity', '=', entity]],
    page_size: 200,
  });
}

export function createSavedView(body: Partial<ListPreferenceDoc>) {
  return createDoc<ListPreferenceDoc>('ListPreference', body as Record<string, unknown>);
}

export function updateSavedView(id: string, body: Partial<ListPreferenceDoc>) {
  return updateDoc<ListPreferenceDoc>('ListPreference', id, body as Record<string, unknown>);
}

export function deleteSavedView(id: string) {
  return deleteDoc('ListPreference', id);
}
