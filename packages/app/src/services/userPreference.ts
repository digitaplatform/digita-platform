import { getList, createDoc, updateDoc } from '@/services/resource';
import { useSessionStore } from '@/stores/session';

/**
 * Generic per-user key-value preference (UserPreference entity). One row per
 * (owner, pref_key) — upsert by lookup. Every lookup filters on the signed-in
 * person as owner: the engine scopes a System User to their own rows, but lets
 * an Administrator list every person's, so the key alone would find another
 * person's row.
 */
export interface UserPreferenceDoc {
  _id: string;
  pref_key: string;
  value: unknown;
  owner?: string;
}

function findOwnRow(key: string) {
  const owner = useSessionStore.getState().user?.email;
  if (!owner) throw new Error(`No signed-in person owns the preference ${key}`);
  return getList<UserPreferenceDoc>('UserPreference', {
    filters: [
      ['owner', '=', owner],
      ['pref_key', '=', key],
    ],
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
