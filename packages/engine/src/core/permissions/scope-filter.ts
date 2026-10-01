import type { EntityDefinition, EntityPermission } from "@digitaplatform/shared";
import { SYSTEM_ROLES, canGrantActionTo } from "@digitaplatform/shared";
import type { UserContext } from "./types.js";

/**
 * Whether `user` reads `entity` only through the role lists of its rows: the entity has a
 * `role_visibility_field` and declares permission rows, none of which names the user's roles. A
 * row there is meant for the roles it lists. A role that a declared row names keeps exactly what
 * the declared rows grant, so a row's role list never widens them. An entity that declares no
 * row stays closed, and Guest, the anonymous caller, never reads this way.
 */
export function readsThroughRoleList(entity: EntityDefinition, user: UserContext): boolean {
  const declared = entity.permissions ?? [];
  return (
    !!entity.role_visibility_field &&
    declared.length > 0 &&
    !user.roles.includes(SYSTEM_ROLES.GUEST) &&
    !declared.some((perm) => user.roles.includes(perm.role))
  );
}

/**
 * The permission rows of `entity` that a check of `user` weighs: the declared rows, or, for a
 * user who reads the entity only through the role lists of its rows, one row per role of the
 * user that selects and reads, at level 0, the rows whose list names one of the user's roles.
 */
export function permissionRowsFor(entity: EntityDefinition, user: UserContext): EntityPermission[] {
  if (!readsThroughRoleList(entity, user)) return entity.permissions ?? [];
  const field = entity.role_visibility_field!;
  return user.roles.map((role) => ({ role, level: 0, select: 1, read: 1, scope: { field, user_field: "roles" } }));
}

/** Normalize a scope value for comparison: Date → epoch ms, ObjectId-like → String. */
function normScope(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && typeof (v as { toString?: unknown }).toString === "function") {
    return String(v);
  }
  return v;
}

/**
 * Canonical scope-match predicate, shared by the single-doc read check and the
 * field-mask check so they agree with the Mongo list filter (which matches by
 * array membership). A `scope`-restricted read admits a doc when the doc's scope
 * value equals the user's — OR, when the doc value is an ARRAY, when the user's
 * value is a member (a doc belonging to several scopes is visible to each). A
 * user value that is an ARRAY matches when one of its members does (a user
 * belonging to several scopes sees each), as the list filter's `$in` does.
 * Returns false for a null/undefined user value (that role then grants nothing).
 */
export function scopeValueMatches(docValue: unknown, userValue: unknown): boolean {
  if (userValue === null || userValue === undefined) return false;
  if (Array.isArray(userValue)) return userValue.some((member) => scopeValueMatches(docValue, member));
  const u = normScope(userValue);
  if (Array.isArray(docValue)) return docValue.some((el) => normScope(el) === u);
  return normScope(docValue) === u;
}

/**
 * Apply permission scope filters to list queries — restricts which documents a
 * user may see based on their role permissions.
 *
 * Semantics (D10c fix): a user sees the UNION (OR) of what each of their
 * read-granting roles allows — RBAC is additive across roles. Each applicable
 * `level 0` read permission contributes one condition:
 *   - `scope`     → `{ <scope.field>: <user[scope.user_field]> }`, or
 *                   `{ <scope.field>: { $in: <the list> } }` when the user's value is a list
 *   - `if_owner`  → `{ owner: <user.email> }`
 *   - neither     → unrestricted read via that role → no scope filter at all
 * The conditions AND-combine with the caller's filters, so a caller's filter on
 * a scoped field narrows the rows the scope admits instead of being replaced.
 *
 * Previously multiple scoped roles were AND-ed (and same-field scopes
 * overwrote each other), which was wrong (too restrictive / last-wins).
 */
/** Both filters: merged flat, unless they constrain the same key, where a flat merge would drop one. */
function andFilters(filters: Record<string, unknown>, condition: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(condition).some((key) => key in filters) ? { $and: [filters, condition] } : { ...filters, ...condition };
}

export function applyScopeFilters(
  entity: EntityDefinition,
  user: UserContext,
  existingFilters: Record<string, unknown>,
): Record<string, unknown> {
  // A personal entity's rows are their owner's alone, for every role.
  if (entity.personal) existingFilters = andFilters(existingFilters, { owner: user.email });
  // Administrator sees everything else.
  if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
    return existingFilters;
  }

  const readPerms = permissionRowsFor(entity, user).filter(
    (p) => canGrantActionTo(p, user.roles) && p.read,
  );

  // No read permission at all → leave filters unchanged (RBAC denies access
  // upstream; this function only narrows what an allowed user can list).
  if (readPerms.length === 0) {
    return existingFilters;
  }

  const conditions: Record<string, unknown>[] = [];
  for (const perm of readPerms) {
    // A perm may declare BOTH scope and if_owner — they AND-combine (the row
    // must match the scope AND be owned), mirroring the single-doc sites
    // (hasPermission / permMatchesDoc). Building only one via if/else-if let the
    // list path surface rows single-doc read forbids.
    const parts: Record<string, unknown>[] = [];
    if (perm.scope) {
      const userValue = (user as Record<string, unknown>)[perm.scope.user_field];
      // scope configured but the user has no value → this role grants nothing
      // (mirrors single-doc, where an undefined userValue always denies).
      if (userValue === undefined || userValue === null) continue;
      parts.push({ [perm.scope.field]: Array.isArray(userValue) ? { $in: userValue } : userValue });
    }
    if (perm.if_owner) {
      parts.push({ owner: user.email });
    }
    if (parts.length === 0) {
      // neither scope nor if_owner → unrestricted read via this role →
      // the union is unrestricted, so apply no scope filter.
      return existingFilters;
    }
    conditions.push(parts.length === 1 ? parts[0]! : { $and: parts });
  }

  // Every applicable role was restricted but produced no usable condition
  // (e.g. scope configured, user has no value) → the user can see nothing.
  if (conditions.length === 0) {
    return { ...existingFilters, _id: { $in: [] as unknown[] } };
  }

  // Single condition → merge flat, unless it constrains a key the caller's filters do: a
  // flat merge would replace the caller's condition, so the two AND instead. Multiple →
  // OR them (union across roles), AND-combined with any pre-existing filters.
  if (conditions.length === 1) return andFilters(existingFilters, conditions[0]!);
  const scopeOr = { $or: conditions };
  return Object.keys(existingFilters).length > 0
    ? { $and: [existingFilters, scopeOr] }
    : scopeOr;
}

/**
 * Generic role-VISIBILITY filter for an entity that declares
 * `role_visibility_field` (e.g. Workspace → "roles"). A document is visible when
 * that field is absent / null / empty, OR intersects the user's roles. Returns
 * `existingFilters` unchanged for Administrators or when the entity does not opt in.
 *
 * Defense-in-depth: the actual card/section DATA is already View-engine-RBAC-gated;
 * this stops a non-privileged user from ENUMERATING role-restricted definitions
 * via the generic resource API.
 */
export function applyRoleVisibilityFilter(
  entity: EntityDefinition,
  user: UserContext,
  existingFilters: Record<string, unknown>,
): Record<string, unknown> {
  const field = entity.role_visibility_field;
  if (!field) return existingFilters;
  if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return existingFilters;

  const visible = {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: { $size: 0 } },
      { [field]: { $in: user.roles } },
    ],
  };
  return Object.keys(existingFilters).length > 0
    ? { $and: [existingFilters, visible] }
    : visible;
}

/**
 * Single-document counterpart of {@link applyRoleVisibilityFilter}: is this row
 * visible to the user? Empty/absent role list = visible to all; Administrator
 * bypasses. Used by getDoc to 404 a role-restricted document the user can't see.
 */
export function isRoleVisible(
  entity: EntityDefinition,
  user: UserContext,
  data: Record<string, unknown>,
): boolean {
  const field = entity.role_visibility_field;
  if (!field) return true;
  if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) return true;
  const raw = data[field];
  if (raw === undefined || raw === null) return true;
  if (!Array.isArray(raw) || raw.length === 0) return true;
  const userRoles = new Set(user.roles);
  return raw.some((r) => userRoles.has(r as string));
}
