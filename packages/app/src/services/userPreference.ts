import { getList, createDoc, updateDoc } from '@/services/resource';

/**
 * Generic per-user key-value preference (UserPreference entity). The entity is
 * personal: the engine answers every role, an Administrator included, only the
 * caller's own rows. One row per (owner, pref_key) — upsert by lookup.
 */
export interface UserPreferenceDoc {
  _id: string;
  pref_key: string;
  value: unknown;
  owner?: string;
}

function findOwnRow(key: string) {
  return getList<UserPreferenceDoc>('UserPreference', {
    filters: [['pref_key', '=', key]],
    page_size: 1,
  });
}

/** Read a preference value (undefined when unset). */
export async function getUserPreference<T = unknown>(key: string): Promise<T | undefined> {
  const res = await findOwnRow(key);
  return res.data?.[0]?.value as T | undefined;
}

/** Upsert a preference value for the current user. */
export async function setUserPreference(key: string, value: unknown): Promise<void> {
  const res = await findOwnRow(key);
  const existing = res.data?.[0];
  if (existing) {
    await updateDoc('UserPreference', existing._id, { value });
  } else {
    await createDoc('UserPreference', { pref_key: key, value });
  }
}
