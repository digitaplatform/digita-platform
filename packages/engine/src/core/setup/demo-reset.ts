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
 * app's data, so it exists only on a tenant marked as a demo (DEMO_TENANT).
 */
const DEMO_RESET = "DemoReset";
/** The single's one row: the action route runs an action on a document. */
const DEMO_RESET_ROW = "demo-reset";

/**
 * Register the entity, its row and the action. The action runs the reseed route's own code with
 * the tiers this engine seeds at boot, so the app returns to the state a fresh boot seeds.
 */
export async function enableDemoReset(
  db: MongoDBService,
  registry: EntityRegistry,
  hookRunner: HookRunner,
  reseed: ReseedDeps,
): Promise<void> {
  registry.register({
    name: DEMO_RESET,
    module: "core",
    database: DIGITA.DATABASES.CORE,
    label: "Demo Reset",
    is_single: true,
    naming: { strategy: "user_set" },
    fields: [],
    actions: [{ action: "reset", label: "Reset app data", long_running: true, confirm: true }],
    permissions: [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1 }],
  } as EntityDefinition);

  await db.ensureCollection(DEMO_RESET, DIGITA.DATABASES.CORE);
  if (!(await db.findOne(DEMO_RESET, DEMO_RESET_ROW, DIGITA.DATABASES.CORE))) {
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
