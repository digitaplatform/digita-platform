import type { EntityDefinition, EntityPermission, FieldDefinition, PermissionAction } from '@digitaplatform/shared';
import { SYSTEM_ROLES, canGrantActionTo } from '@digitaplatform/shared';
import type { SessionUser } from '@/types';
import { evaluateExpr } from '@/lib/expression';
import { resolveWorkflowField } from '@/lib/workflow-field';

/**
 * Frontend permission helpers. The engine is the authoritative security boundary;
 * these only gate AFFORDANCES (hide a New button, lock a field the user can't
 * write) so the UI doesn't invite an action the engine will reject. Administrator
 * bypasses, mirroring the engine.
 */

/** An action a permission row can grant, named as in PermissionAction. */
export type PermAction = `${PermissionAction}`;

export function isAdministrator(user: SessionUser | null | undefined): boolean {
  return !!user?.roles?.includes(SYSTEM_ROLES.ADMINISTRATOR);
}

/**
 * Whether the engine withheld the entity's permission rows, as it does for a caller outside the
 * internal audience. The app then cannot judge that caller's actions and leaves them to the engine.
 */
function isMatrixWithheld(entity: Pick<EntityDefinition, 'permissions'>): boolean {
  return (entity.permissions ?? []).length === 0;
}

/**
 * Does the user hold `action` on the entity through a level-0 row, as the engine requires? Where
 * the engine withheld the matrix, the answer is yes, so the engine judges the action.
 */
export function hasEntityPermission(
  entity: Pick<EntityDefinition, 'permissions'>,
  user: SessionUser | null | undefined,
  action: PermAction,
): boolean {
  if (!user) return false;
  if (isAdministrator(user) || isMatrixWithheld(entity)) return true;
  return (entity.permissions ?? []).some((p) => canGrantActionTo(p, user.roles) && p[action] === 1);
}

type RecordRules = Pick<EntityDefinition, 'permissions' | 'states' | 'transitions' | 'workflow_field'>;

/**
 * Does the user hold `action` on this record, as the engine checks it against the stored
 * record: through a level-0 row whose role the record's workflow state does not strip of it,
 * and whose `if_owner`, `condition` and `scope` admit the record? Where the engine withheld the
 * matrix, the answer is yes, so the engine judges the action.
 */
export function hasRecordPermission(
  entity: RecordRules,
  user: SessionUser | null | undefined,
  action: PermAction,
  record: Record<string, unknown>,
): boolean {
  if (!user) return false;
  if (isAdministrator(user) || isMatrixWithheld(entity)) return true;
  return (entity.permissions ?? []).some(
    (p) =>
      canGrantActionTo(p, user.roles) &&
      p[action] === 1 &&
      !stateStrips(entity, record, p.role, action) &&
      rowAdmits(p, user, record),
  );
}

/**
 * Whether the row's `if_owner`, `condition` and `scope` admit the record. A gate the app cannot
 * judge from what it holds leaves the row standing, so the app never hides what the engine may
 * allow: an owner this reader may not see, a condition the app's evaluator cannot read, a record
 * field this reader may not read, a user attribute the session does not carry. Such a row may
 * show an action the engine then refuses.
 */
function rowAdmits(p: EntityPermission, user: SessionUser, record: Record<string, unknown>): boolean {
  const owner = record['owner'];
  // The engine matches an owner by email alone, in a row check as in a list.
  if (p.if_owner && owner !== undefined && owner !== user.email) return false;
  if (p.condition) {
    const met = evaluateExpr(p.condition, {
      doc: record,
      user: user as unknown as Record<string, unknown>,
      isPartial: true,
    });
    if (!met.error && !met.value) return false;
  }
  if (p.scope) {
    const userValue = (user as unknown as Record<string, unknown>)[p.scope.user_field];
    if (userValue !== undefined && !scopeMatches(record[p.scope.field], userValue)) return false;
  }
  return true;
}

/** The engine's scope match: the record's value is the user's, or a list that holds it. A user
 *  value that is a list matches through any of its members. */
function scopeMatches(recordValue: unknown, userValue: unknown): boolean {
  if (userValue === null) return false;
  if (Array.isArray(userValue)) return userValue.some((member) => scopeMatches(recordValue, member));
  return Array.isArray(recordValue) ? recordValue.includes(userValue) : recordValue === userValue;
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
 * level. Administrator → always true, and so where the engine withheld the matrix, which leaves
 * the fields to the engine. A field whose perm_level fails this becomes read-only in the form
 * (so the user never types into a field the engine drops).
 */
export function writableLevelPredicate(
  entity: Pick<EntityDefinition, 'permissions'>,
  user: SessionUser | null | undefined,
): (level: number) => boolean {
  if (isAdministrator(user) || (user && isMatrixWithheld(entity))) return () => true;
  const roles = new Set(user?.roles ?? []);
  const levels = new Set<number>();
  for (const p of entity.permissions ?? []) {
    if (roles.has(p.role) && p.write === 1) levels.add(p.level ?? 0);
  }
  return (level: number) => levels.has(level);
}

/**
 * A predicate over a field (its name and `perm_level`): true when the user may read it, as the
 * engine decides which fields a read answers (PermissionChecker.getReadableFields). A read row of
 * one of the user's roles opens the fields of its level, or only those its `fields` names, where
 * its gates admit the record; for a Table child, the row must open the Table. Where no row
 * grants read on the record, a share admitted it, and level 0 shows. Without a record, as for a
 * list, a row's gates are not judged: they differ from row to row.
 */
export function readableFieldPredicate(
  entity: RecordRules,
  user: SessionUser | null | undefined,
  record?: Record<string, unknown>,
): (fieldname: string, level: number) => boolean {
  if (!user) return () => false;
  // The engine sends a caller outside the internal audience only the fields it may read.
  if (isAdministrator(user) || isMatrixWithheld(entity)) return () => true;
  const rows: Pick<EntityPermission, 'level' | 'fields'>[] = (entity.permissions ?? []).filter(
    (p) => p.read === 1 && user.roles.includes(p.role) && (!record || rowAdmits(p, user, record)),
  );
  if (record && !hasRecordPermission(entity, user, 'read', record)) rows.push({ level: 0 });
  return (fieldname, level) => rows.some((row) => row.level === level && (!row.fields || row.fields.includes(fieldname)));
}

/** The child fields of a Table the user may read. Like the engine, a Table whose children all
 *  sit at level 0 shows every child to whoever may read the Table. */
export function readableChildFields(
  table: FieldDefinition,
  canReadField: (fieldname: string, level: number) => boolean,
): FieldDefinition[] {
  const children = table.child_fields ?? [];
  if (!children.some((c) => (c.perm_level ?? 0) > 0)) return children;
  return children.filter((c) => canReadField(table.fieldname, c.perm_level ?? 0));
}
