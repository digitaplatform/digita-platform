/**
 * Physical Mongo database-name resolution (pure). Composes the platform
 * prefix, an optional tenant GUID, an optional app name, and the logical
 * role/domain suffix into one underscore-joined name. Empty segments drop
 * out, so the same function yields every supported shape:
 *
 *   <guid>_<app>_<suffix>_<stage>  multi-tenant   (TENANT_ID + APP_NAME + STAGE set)
 *   digita_<app>_<suffix>          single-tenant  (only APP_NAME / legacy INSTANCE_ID)
 *   digita_<suffix>                local dev/tests (neither set)
 *
 * `stage` is appended LAST (a postfix, e.g. ..._dev) so a tenant's DBs are also
 * distinguishable per environment; empty stage drops out like every other segment.
 *
 * Every customer deployment sets a distinct TENANT_ID — a short, immutable GUID
 * — so many customers share one MongoDB cluster without name collision. DBs stay
 * keyed by the GUID, never by the mutable subdomain, so a subdomain rename never
 * touches a database name. Kept standalone so it's unit-testable without
 * evaluating the full env (which requires MONGODB_URI).
 */
export function dbName(
  prefix: string,
  tenantId: string,
  appName: string,
  suffix: string,
  stage = "",
): string {
  // filter(Boolean) drops empty segments, so this one join yields every shape above.
  return [prefix, tenantId, appName, suffix, stage].filter(Boolean).join("_");
}
