import type { EntityDefinition } from '@digitaplatform/shared';
import { SYSTEM_ROLES, canGrantActionTo } from '@digitaplatform/shared';
import type { SessionUser } from '@/types';
import { resolveWorkflowField } from '@/lib/workflow-field';

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

/** Does the user hold `action` on the entity through a level-0 row, as the engine requires? */
export function hasEntityPermission(
  entity: Pick<EntityDefinition, 'permissions'>,
  user: SessionUser | null | undefined,
  action: PermAction,
): boolean {
  if (!user) return false;
  if (isAdministrator(user)) return true;
  return (entity.permissions ?? []).some((p) => canGrantActionTo(p, user.roles) && p[action] === 1);
}

type RecordRules = Pick<EntityDefinition, 'permissions' | 'states' | 'transitions' | 'workflow_field'>;

/**
 * Does the user hold `action` on this record, as the engine checks it against the stored
 * record: through a level-0 row whose role the record's workflow state does not strip of it?
 */
export function hasRecordPermission(
  entity: RecordRules,
  user: SessionUser | null | undefined,
  action: PermAction,
  record: Record<string, unknown>,
): boolean {
  if (!user) return false;
  if (isAdministrator(user)) return true;
  return (entity.permissions ?? []).some(
    (p) => canGrantActionTo(p, user.roles) && p[action] === 1 && !stateStrips(entity, record, p.role, action),
  );
}

/** Whether the record's workflow state takes `action` from `role`. Like the engine, only the
 *  state's first entry for the role counts, and only these five actions can be stripped. */
function stateStrips(entity: RecordRules, record: Record<string, unknown>, role: string, action: PermAction): boolean {
  const field = resolveWorkflowField(entity);
  const value = field ? record[field] : undefined;
  if (typeof value !== 'string') return false;
  const strip = entity.states?.find((s) => s.value === value)?.permissions?.find((p) => p.role === role);
  if (!strip) return false;
  switch (action) {
    case 'read':
    case 'write':
    case 'submit':
    case 'cancel':
    case 'delete':
      return strip[action] === 0;
    default:
      return false;
  }
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
