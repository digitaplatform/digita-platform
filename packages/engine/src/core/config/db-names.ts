import { ConfigurationError } from "../errors/engine-error.js";

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

/**
 * The databases a tenant engine may open, keyed by suffix (core, logs, audits, auth and
 * every domain): the map its chart's ServiceClaim grants, handed over as
 * MONGODB_DATABASE_NAMES. A tenant engine opens exactly these and composes no name.
 */
export type DatabaseNames = Readonly<Record<string, string>>;

export function parseDatabaseNames(json: string): DatabaseNames {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ConfigurationError("setting_not_json", { setting: "MONGODB_DATABASE_NAMES" });
  }
  const isNameMap =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((name) => typeof name === "string" && name !== "");
  if (!isNameMap) throw new ConfigurationError("database_names_not_map");
  return parsed as DatabaseNames;
}

export function grantedDatabaseName(names: DatabaseNames, suffix: string): string {
  const name = names[suffix];
  if (!name) {
    throw new ConfigurationError("database_not_granted", { suffix, granted: Object.keys(names).join(", ") });
  }
  return name;
}
