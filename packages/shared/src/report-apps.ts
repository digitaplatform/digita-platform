import type { ReportCollection } from "./types/report.js";

/**
 * App affiliation of a report (list grouping — digita-report).
 *
 * A report's app is DERIVABLE from where its data comes from: logical
 * database targets embed the owning app as the prefix before the first "_"
 * — the engine's `<app>_<domain>` database convention ("erp_sales" → "erp",
 * "buildproject_controlling" → "buildproject"; a segment-less target like
 * "app" is its own prefix). An explicit `definition.app` mark overrides the
 * derivation. Shared so the backend's list summaries and the designer's
 * report-meta editor agree on ONE rule.
 */

/** The app prefix of a logical database target ("erp_sales" → "erp"). */
export function databaseApp(database: string): string {
  const sep = database.indexOf("_");
  return sep === -1 ? database : database.slice(0, sep);
}

/** The minimal definition shape reportApps() needs (a projected stored
 *  definition — `app` + `data.collections[*].database` — works too). */
export interface ReportAppsInput {
  app?: string;
  data: { collections: Record<string, Pick<ReportCollection, "database">> };
}

/**
 * The apps a report belongs to: `[definition.app]` when the explicit mark is
 * set, else the sorted-unique app prefixes of the collections' databases
 * (`[]` without any data source). The first entry is the PRIMARY app a
 * multi-app report groups under in the list UI.
 */
export function reportApps(definition: ReportAppsInput): string[] {
  if (definition.app !== undefined) return [definition.app];
  const apps = new Set<string>();
  for (const coll of Object.values(definition.data.collections)) {
    apps.add(databaseApp(coll.database));
  }
  return [...apps].sort();
}
