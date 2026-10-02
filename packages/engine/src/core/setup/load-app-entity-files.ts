import { join } from "path";
import { env } from "../config/env.js";
import { registerAppDatabases, type DomainDirectory } from "../database/app-db-discovery.js";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";

/**
 * Load an app's entity files as the engine boots it: the engine's own entities first, then each
 * app dir's `entities/`, then each domain's `entities/` under the database that
 * `registerAppDatabases` registers for it. A later file overrides an earlier one by name.
 */
export async function loadAppEntityFiles(
  db: MongoDBService,
  registry: EntityRegistry,
): Promise<{ entityDirs: string[]; domainDirs: DomainDirectory[] }> {
  const entityDirs = [env.ENTITIES_DIR, ...env.APP_DIRS.map((d) => join(d, "entities"))];
  const domainDirs = env.APP_DIRS.length > 0 ? await registerAppDatabases(db, env.APP_DIRS) : [];
  for (const dir of entityDirs) await registry.loadAll(dir);
  for (const d of domainDirs) await registry.loadAll(join(d.root, "entities"), { defaultDatabase: d.dbName });
  return { entityDirs, domainDirs };
}
