import { getList, createDoc, updateDoc } from '@/services/resource';

/**
 * Generic per-user key-value preference (UserPreference entity). The engine
 * scopes reads/writes to the owner (if_owner), so these only ever touch the
 * current user's row. One row per (owner, pref_key) — upsert by lookup.
 */
export interface UserPreferenceDoc {
  _id: string;
  pref_key: string;
  value: unknown;
  owner?: string;
}

/** Read a preference value (undefined when unset). */
export async function getUserPreference<T = unknown>(key: string): Promise<T | undefined> {
  const res = await getList<UserPreferenceDoc>('UserPreference', {
    filters: [['pref_key', '=', key]],
    page_size: 1,
  });
  return res.data?.[0]?.value as T | undefined;
}

/** Upsert a preference value for the current user. */
export async function setUserPreference(key: string, value: unknown): Promise<void> {
  const res = await getList<UserPreferenceDoc>('UserPreference', {
    filters: [['pref_key', '=', key]],
    page_size: 1,
  });
  const existing = res.data?.[0];
  if (existing) {
    await updateDoc('UserPreference', existing._id, { value });
  } else {
    await createDoc('UserPreference', { pref_key: key, value });
  }
}
