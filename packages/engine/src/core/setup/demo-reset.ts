import { DIGITA, SYSTEM_ROLES, type EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { SchemaMigrator } from "../database/schema-migrator.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { HookRunner } from "../hooks/hook-runner.js";
import { env } from "../config/env.js";
import { reseedAppData, type ReseedDeps } from "./reseed-app-data.js";

/**
 * The demo reset: the single `DemoReset` with its `long_running` action `reset`. As an action it
 * is what the Jobs page lists per app, schedules nightly and keeps a run record of. It wipes the
 * app's data, so it exists only where the engine may reseed (`isReseedAllowed`): on an app
 * engine of a tenant marked as a demo, never on a website engine.
 */
const DEMO_RESET = "DemoReset";
/** The single's one row: the action route runs an action on a document. */
const DEMO_RESET_ROW = "demo-reset";

/** The demo reset's entity definition, as `enableDemoReset` registers it. */
export function demoResetDefinition(): EntityDefinition {
  return {
    name: DEMO_RESET,
    module: "core",
    database: DIGITA.DATABASES.CORE,
    label: "Demo Reset",
    is_single: true,
    naming: { strategy: "user_set" },
    fields: [],
    // `write`: no row below grants it, so only the Administrator passes, by the permission check's
    // bypass. The action route itself asks only for read, which a DocShare of the row grants.
    actions: [
      { action: "reset", label: "Reset app data", long_running: true, confirm: true, requires_permission: "write" },
    ],
    permissions: [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1 }],
  } as EntityDefinition;
}

/**
 * Register the entity, its row and the action. The action runs the reseed route's own code: it
 * wipes the app's data and loads the seed tiers this engine loads at boot, `seeds/` and, where the
 * demo tier is on, `seeds-demo/`. It loads no site folder, which is where a website engine's pages
 * come from, so a website engine must never get it.
 */
export async function enableDemoReset(
  db: MongoDBService,
  registry: EntityRegistry,
  hookRunner: HookRunner,
  reseed: ReseedDeps,
): Promise<void> {
  registry.register(demoResetDefinition());

  await db.ensureCollection(DEMO_RESET, DIGITA.DATABASES.CORE);
  if (!(await db.findOne(DEMO_RESET, DEMO_RESET_ROW, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true }))) {
    const now = new Date();
    await db.insertOne(
      DEMO_RESET,
      {
        _id: DEMO_RESET_ROW,
        doctype: DEMO_RESET,
        docstatus: 0,
        owner: "system",
        modified_by: "system",
        creation: now,
        modified: now,
      },
      DIGITA.DATABASES.CORE,
    );
  }

  hookRunner.registerAction(DEMO_RESET, "reset", async () => ({
    done: true,
    result: await reseedAppData(env.SEED_DEMO_DATA_ON_BOOT ? "demo" : "template", reseed),
  }));
}

/**
 * On a tenant that is no demo, remove what a boot as a demo stored: the definition, which
 * `loadFromDb` would register again, and the row.
 */
export async function removeDemoReset(db: MongoDBService): Promise<void> {
  await new SchemaMigrator(db).removeRetiredEntity({ name: DEMO_RESET, database: DIGITA.DATABASES.CORE });
}
