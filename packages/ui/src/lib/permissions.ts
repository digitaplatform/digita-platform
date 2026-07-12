import type { EntityDefinition } from '@digitaplatform/shared';
import { SYSTEM_ROLES } from '@digitaplatform/shared';
import type { SessionUser } from '@/types';

/**
 * Frontend permission helpers. The engine is the authoritative security boundary;
 * these only gate AFFORDANCES (hide a New button, lock a field the user can't
 * write) so the UI doesn't invite an action the engine will reject. Administrator
 * bypasses, mirroring the engine.
 */

export type PermAction =
  | 'select'
  | 'read'
  | 'write'
  | 'create'
  | 'delete'
  | 'submit'
  | 'cancel'
  | 'amend'
  | 'print'
  | 'email'
  | 'export'
  | 'import'
  | 'share'
  | 'report';

export function isAdministrator(user: SessionUser | null | undefined): boolean {
  return !!user?.roles?.includes(SYSTEM_ROLES.ADMINISTRATOR);
}

/** Does the user hold `action` on the entity at any permission level? */
export function hasEntityPermission(
  entity: Pick<EntityDefinition, 'permissions'>,
  user: SessionUser | null | undefined,
  action: PermAction,
): boolean {
  if (!user) return false;
  if (isAdministrator(user)) return true;
  const roles = new Set(user.roles);
  return (entity.permissions ?? []).some((p) => roles.has(p.role) && p[action] === 1);
}

/**
 * A predicate over field `perm_level`: true when the user may WRITE fields at that
 * level. Administrator → always true. A field whose perm_level fails this becomes
 * read-only in the form (so the user never types into a field the engine drops).
 */
export function writableLevelPredicate(
  entity: Pick<EntityDefinition, 'permissions'>,
  user: SessionUser | null | undefined,
): (level: number) => boolean {
  if (isAdministrator(user)) return () => true;
  const roles = new Set(user?.roles ?? []);
  const levels = new Set<number>();
  for (const p of entity.permissions ?? []) {
    if (roles.has(p.role) && p.write === 1) levels.add(p.level ?? 0);
  }
  return (level: number) => levels.has(level);
}
