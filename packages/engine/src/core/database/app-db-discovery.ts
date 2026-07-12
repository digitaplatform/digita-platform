import { readdir, stat } from "fs/promises";
import { basename, join } from "path";
import { createLogger } from "../logging/logger.js";
import type { AppDatabaseDefinition, MongoDBService } from "./mongodb-service.js";

const log = createLogger("app-db-discovery");

export interface DomainDirectory {
  /** Path to the domain folder (e.g. `./<app>/master`). */
  root: string;
  /** Logical database name (`<appname>_<sub>`, e.g. `<app>_master`). */
  dbName: string;
  /** App-dir basename (e.g. `<app>`). */
  app: string;
  /** Subfolder name (e.g. `master`). */
  domain: string;
}

/**
 * Scan an APP_DIR for domain subfolders that declare their own database.
 *
 * Convention: any direct subfolder of `<appDir>` containing an `entities/`
 * directory is treated as a "domain" — i.e. its own logical database. The
 * folder name plus the app-dir basename forms the logical database target,
 * e.g. `./<app>/master/entities/...` → database `<app>_master`.
 *
 * Top-level `<appDir>/entities/` is NOT a domain folder; it is a legacy
 * shared bucket that maps to the catch-all `app` database. This function
 * deliberately ignores it.
 */
export async function discoverDomainDirectories(appDir: string): Promise<DomainDirectory[]> {
  const out: DomainDirectory[] = [];
  const app = basename(appDir).replace(/[^A-Za-z0-9_-]/g, "_");
  let entries;
  try {
    entries = await readdir(appDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    if (RESERVED_APP_SUBDIRS.has(entry.name)) continue;
    const sub = join(appDir, entry.name);
    let hasEntitiesDir = false;
    try {
      const s = await stat(join(sub, "entities"));
      hasEntitiesDir = s.isDirectory();
    } catch {
      hasEntitiesDir = false;
    }
    if (!hasEntitiesDir) continue;
    out.push({
      root: sub,
      dbName: `${app}_${entry.name}`,
      app,
      domain: entry.name,
    });
  }
  return out;
}

/**
 * Subfolders directly under an app dir that the platform already owns —
 * they are NOT to be confused with domain databases.
 */
const RESERVED_APP_SUBDIRS = new Set([
  "entities",
  "modules",
  "locales",
  "seeds",
  "seeds-demo",
  "rules",
  "views",
  "node_modules",
  "dist",
  "build",
]);

/** Discover and register every domain database across all configured app dirs. */
export async function registerAppDatabases(
  db: MongoDBService,
  appDirs: string[],
): Promise<DomainDirectory[]> {
  const all: DomainDirectory[] = [];
  for (const appDir of appDirs) {
    const found = await discoverDomainDirectories(appDir);
    for (const d of found) {
      const def: AppDatabaseDefinition = {
        name: d.dbName,
        label: `${d.app}/${d.domain}`,
      };
      db.registerAppDatabase(def);
      all.push(d);
    }
  }
  log.info({ count: all.length, dbs: all.map((d) => d.dbName) }, "Domain databases registered");
  return all;
}
