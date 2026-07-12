import { SYSTEM_ROLES, type AudienceGrant } from "@digitaplatform/shared";

export type { EntityPermission } from "@digitaplatform/shared";
export { PermissionAction } from "@digitaplatform/shared";
export { SYSTEM_ROLES };

export interface UserContext {
  _id: string;
  email: string;
  roles: string[];
  full_name?: string;
  language?: string;
  /**
   * Audience-set from the token's `tiers` list claim (ADR-A1): which
   * authenticated worlds this user may enter. Normalized by the verify adapter
   * (present claim → filtered `AudienceGrant[]`; absent → `undefined`, so
   * consumers apply their own transitional/fail-safe rule). Presentation-scoping
   * only — never a data boundary (RBAC stays that).
   */
  tiers?: AudienceGrant[];
  // App-defined principal attributes from the verified token (non-reserved JWT
  // claims) land here — consumed generically by permission `scope.user_field`
  // (any dimension an app scopes on, e.g. company / department / tenant).
  [key: string]: unknown;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Normalize the User document's `roles` field to a flat string[].
 *
 * Storage shape after the link_collection removal: each row is a
 * subdocument `{ role: string, _row_id: string }`. The defensive branch
 * handles legacy User documents that still carry the old `string[]`
 * shape until the data migration completes.
 */
export function rolesToStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): string | null => {
      if (typeof r === "string") return r;
      if (r && typeof r === "object" && typeof (r as { role?: unknown }).role === "string") {
        return (r as { role: string }).role;
      }
      return null;
    })
    .filter((r): r is string => r !== null);
}

/**
 * Tenant-global super-roles every engine honors regardless of app scope. They
 * are deliberately cross-app (platform administration), so they ride the token
 * UNPREFIXED and are never namespaced to a single app.
 */
export const TENANT_GLOBAL_ROLES: readonly string[] = [
  SYSTEM_ROLES.ADMINISTRATOR,
  SYSTEM_ROLES.SYSTEM_USER,
];

const TENANT_GLOBAL_ROLE_SET: ReadonlySet<string> = new Set(TENANT_GLOBAL_ROLES);

/**
 * Scope a verified token's roles to those THIS engine honors (per-app role
 * scoping, decision D3). One tenant IdP mints a single token that every app's
 * engine verifies via shared JWKS, so per-app roles are namespaced
 * `"<app>:<RoleName>"` (e.g. `app1:Manager`). An engine configured for `appName`
 * honors ONLY:
 *
 *  - the tenant-global super-roles {@link TENANT_GLOBAL_ROLES} (carried unprefixed), and
 *  - roles bearing its own `"<appName>:"` prefix — the prefix is STRIPPED so the
 *    bare role name feeds the entity permission map unchanged.
 *
 * Every other app's roles are dropped. A token bearing only `app1:Manager`
 * therefore resolves to ZERO honored roles (hence zero permissions) in a
 * `buildproject`-configured engine, while `Administrator` is honored everywhere.
 *
 * When `appName` is empty (local dev / legacy single-tenant) NO scoping is
 * applied and every role passes through verbatim — matching the DB-naming
 * convention where an empty `APP_NAME` collapses to the legacy unprefixed shape.
 *
 * @param roles - Raw role names from the verified token (already normalized to a flat `string[]`).
 * @param appName - This engine's configured app name (`env.APP_NAME`); empty disables scoping.
 * @returns The honored, de-duplicated, prefix-stripped role names for permission mapping.
 */
export function scopeRolesToApp(roles: readonly string[], appName: string): string[] {
  if (!appName) return [...roles];
  const prefix = `${appName}:`;
  const honored = new Set<string>();
  for (const role of roles) {
    if (TENANT_GLOBAL_ROLE_SET.has(role)) {
      honored.add(role);
    } else if (role.startsWith(prefix)) {
      const bare = role.slice(prefix.length);
      if (bare) honored.add(bare);
    }
  }
  return [...honored];
}
