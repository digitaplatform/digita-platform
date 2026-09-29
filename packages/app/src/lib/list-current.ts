/** The record last opened from an entity's list, kept for the tab's lifetime so the
 *  list marks that row when the operator comes back to it. */
const key = (entity: string) => `list.current:${entity}`;

export function readCurrentRecord(entity: string): string | undefined {
  return sessionStorage.getItem(key(entity)) ?? undefined;
}

export function rememberCurrentRecord(entity: string, id: string): void {
  sessionStorage.setItem(key(entity), id);
}
