import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import type { UserContext } from "./types.js";

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
 * value is a member (a doc belonging to several scopes is visible to each).
 * Returns false for a null/undefined user value (that role then grants nothing).
 */
export function scopeValueMatches(docValue: unknown, userValue: unknown): boolean {
  if (userValue === null || userValue === undefined) return false;
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
 *   - `scope`     → `{ <scope.field>: <user[scope.user_field]> }`
 *   - `if_owner`  → `{ owner: <user.email> }`
 *   - neither     → unrestricted read via that role → no scope filter at all
 *
 * Previously multiple scoped roles were AND-ed (and same-field scopes
 * overwrote each other), which was wrong (too restrictive / last-wins).
 */
export function applyScopeFilters(
  entity: EntityDefinition,
  user: UserContext,
  existingFilters: Record<string, unknown>,
  /** Honor `permission.scope` (a generic field-equality narrowing — an app may
   *  scope by any dimension, e.g. company / department / tenant). When false,
   *  scope-only roles are treated as unrestricted — used to keep scope enforcement
   *  inert until the principal carries the matching claim. `if_owner` is always
   *  honored regardless. */
  enforceScope = true,
): Record<string, unknown> {
  // Administrator sees everything.
  if (user.roles.includes(SYSTEM_ROLES.ADMINISTRATOR)) {
    return existingFilters;
  }

  const readPerms = entity.permissions.filter(
    (p) => user.roles.includes(p.role) && p.level === 0 && p.read,
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
    if (perm.scope && enforceScope) {
      const userValue = (user as Record<string, unknown>)[perm.scope.user_field];
      // scope configured but the user has no value → this role grants nothing
      // (mirrors single-doc, where an undefined userValue always denies).
      if (userValue === undefined || userValue === null) continue;
      parts.push({ [perm.scope.field]: userValue });
    }
    if (perm.if_owner) {
      parts.push({ owner: user.email });
    }
    if (parts.length === 0) {
      // neither scope(enabled) nor if_owner → unrestricted read via this role →
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

  // Single condition → merge flat. Multiple → OR them (union across roles),
  // AND-combined with any pre-existing filters.
  if (conditions.length === 1) {
    return { ...existingFilters, ...conditions[0] };
  }
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
