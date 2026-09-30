/**
 * The contract of the renderer's cache purge (digita-web `POST /api/revalidate`): the engine posts
 * `{ "tags": [entityCacheTag(doctype)] }` with the shared secret in REVALIDATE_SECRET_HEADER after
 * a committed write of an entity that grants Guest read, and the renderer tags every read of that
 * entity with the same tag.
 */
export const REVALIDATE_SECRET_HEADER = "x-revalidate-secret";

/** The cache tag of every renderer read of one entity. */
export function entityCacheTag(doctype: string): string {
  return `entity:${doctype}`;
}
