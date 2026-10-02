import { DIGITA, SYSTEM_ROLES, type EntityDefinition, type FieldDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import { SchemaMigrator } from "../database/schema-migrator.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { HookRunner, HookServices } from "../hooks/hook-runner.js";
import type { BaseDocument } from "../document/base-document.js";
import type { PendingSetupRecord } from "./setup-state.js";
import { SetupIncompleteError } from "./setup-state.js";
import { EngineError } from "../errors/engine-error.js";
import { SEED_HASH_FIELD } from "../entity/field-types.js";
import { env } from "../config/env.js";
import { seedHash } from "./seed-app-data.js";
import { reseedAppData, type DemoDataOperation, type ReseedDeps, type ReseedSummary } from "./reseed-app-data.js";

/**
 * The demo data of an app, as an Administrator loads, resets and removes it inside the app: the
 * single `DemoData` with one action per operation. On a showcase tenant (`DEMO_TENANT`) it carries
 * only `reset`, a total reset the Jobs page runs every night. Everywhere else it carries `load`,
 * and `reset` and `remove` while the demo data is loaded. It exists only on an app engine: a
 * website engine takes its pages from its site folder, which no operation loads.
 */
const DEMO_DATA = "DemoData";
/** The single's one row: the action route runs an action on a document. */
const DEMO_DATA_ROW = "demo-data";
/** The entity this one replaced; a boot removes what an earlier release stored of it. */
const RETIRED_DEMO_RESET = "DemoReset";
/** The writer the stamps name when a boot loads the demo tier. */
const BOOT = "boot";

export type DemoDataKind = "showcase" | "tenant";

/** Which demo data this engine offers, or none: `hasDemoTier` says whether a `seeds-demo/` folder exists. */
export function findDemoDataKind(hasDemoTier: boolean): DemoDataKind | undefined {
  if (env.SITE_ID) return undefined;
  if (env.DEMO_TENANT) return "showcase";
  return hasDemoTier ? "tenant" : undefined;
}

/** The stamps of the `DemoData` row: who loaded and who removed the demo data, and when. */
export interface DemoDataStamps {
  loaded_at?: Date | string | null;
  loaded_by?: string | null;
  removed_at?: Date | string | null;
  removed_by?: string | null;
}

/** The demo data is loaded when a load is stamped and no removal after it. */
export function isLoaded(stamps: DemoDataStamps): boolean {
  if (!stamps.loaded_at) return false;
  return !stamps.removed_at || new Date(stamps.loaded_at) > new Date(stamps.removed_at);
}

/** The same rule as `isLoaded`, in the expression grammar of `show_if`. */
const LOADED = "!!doc.loaded_at && (!doc.removed_at || doc.loaded_at > doc.removed_at)";

const APP_ID_DESCRIPTION = "The id of this app, typed to confirm that its data is deleted";

const appIdField = (): FieldDefinition =>
  ({ fieldname: "app_id", fieldtype: "Data", label: "App id", required: true, description: APP_ID_DESCRIPTION }) as FieldDefinition;

/**
 * The definition of the kind. A destructive operation asks for the app's id, `APP_NAME`, so an
 * engine without one offers none: an empty id would confirm nothing.
 */
export function demoDataDefinition(kind: DemoDataKind): EntityDefinition {
  const stamp = (fieldname: string, fieldtype: "Datetime" | "Data", label: string) => ({ fieldname, fieldtype, label, read_only: true });
  // `write`: no row below grants it, so only the Administrator passes, by the permission check's
  // bypass. The action route itself asks only for read, which a DocShare of the row grants.
  const destructive = (action: "reset" | "remove", label: string) => ({
    action,
    label,
    type: "danger" as const,
    requires_permission: "write",
    opens_dialog: true,
    dialog_fields: [appIdField()],
    show_if: LOADED,
  });
  const actions: EntityDefinition["actions"] = [];
  if (kind === "showcase") {
    if (env.APP_NAME) {
      // A scheduled run cannot type, so the Jobs page asks for the id once, as a param; a person on
      // the record page types it into the dialog.
      actions.push({
        action: "reset",
        label: "Reset app data",
        type: "danger",
        requires_permission: "write",
        long_running: true,
        opens_dialog: true,
        dialog_fields: [appIdField()],
        params: [{ name: "app_id", label: "App id", type: "string", description: APP_ID_DESCRIPTION }],
      });
    }
  } else {
    actions.push({ action: "load", label: "Load demo data", confirm: true, requires_permission: "write", show_if: `!(${LOADED})` });
    if (env.APP_NAME) actions.push(destructive("reset", "Reset demo data"), destructive("remove", "Remove demo data"));
  }
  return {
    name: DEMO_DATA,
    module: "core",
    database: DIGITA.DATABASES.CORE,
    label: "Demo Data",
    is_single: true,
    naming: { strategy: "user_set" },
    fields: [
      stamp("loaded_at", "Datetime", "Loaded at"),
      stamp("loaded_by", "Data", "Loaded by"),
      stamp("removed_at", "Datetime", "Removed at"),
      stamp("removed_by", "Data", "Removed by"),
    ],
    actions,
    permissions: [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1 }],
  } as EntityDefinition;
}

/** Refused because the demo data is not in the state the operation needs, or its app id differs. */
export class DemoDataRefusedError extends EngineError {}

const refuse = {
  loaded: () => new DemoDataRefusedError("demo_data_loaded", {}, 409, "DEMO_DATA_LOADED"),
  notLoaded: () => new DemoDataRefusedError("demo_data_not_loaded", {}, 409, "DEMO_DATA_NOT_LOADED"),
  records: (count: number) => new DemoDataRefusedError("demo_data_records_exist", { count: String(count) }, 409, "DEMO_DATA_RECORDS_EXIST"),
  appId: () => new DemoDataRefusedError("demo_data_app_id", { app_id: env.APP_NAME }, 400, "DEMO_DATA_APP_ID"),
};

/** The records of one entity that the demo data did not write, as `load` and the counts read them. */
export interface RecordCount {
  entity: string;
  count: number;
}

/** The entities of the app databases whose records are the app's data: every one but its settings. */
function listRecordEntities(db: MongoDBService, registry: EntityRegistry): EntityDefinition[] {
  const appDbs = db.listAppDatabases().map((d) => d.name);
  return registry.getAll().filter((e) => !e.is_single && appDbs.includes(e.database));
}

/**
 * The records nobody seeded, per entity: a row without the seed's hash. A settings record is the
 * customer's own configuration and does not count. A row stored before the seed stamped its rows
 * has no hash either, and counts.
 */
export async function listUnseededRecords(db: MongoDBService, registry: EntityRegistry): Promise<RecordCount[]> {
  const counts: RecordCount[] = [];
  for (const entity of listRecordEntities(db, registry)) {
    const count = await db.collection(entity.name, entity.database).countDocuments({ [SEED_HASH_FIELD]: { $exists: false } });
    if (count > 0) counts.push({ entity: entity.name, count });
  }
  return counts;
}

/** The records whose values no longer hash to what the seed stamped, per entity: a person, a rule or a job changed them. */
export async function listChangedRecords(db: MongoDBService, registry: EntityRegistry): Promise<RecordCount[]> {
  const counts: RecordCount[] = [];
  for (const entity of listRecordEntities(db, registry)) {
    const rows = await db.collection(entity.name, entity.database).find({ [SEED_HASH_FIELD]: { $exists: true } }).toArray();
    const count = rows.filter((row) => row[SEED_HASH_FIELD] !== seedHash(row as Record<string, unknown>)).length;
    if (count > 0) counts.push({ entity: entity.name, count });
  }
  return counts;
}

export async function readDemoDataStamps(db: MongoDBService): Promise<DemoDataStamps> {
  return ((await db.findOne(DEMO_DATA, DEMO_DATA_ROW, DIGITA.DATABASES.CORE)) ?? {}) as DemoDataStamps;
}

async function stamp(db: MongoDBService, stamps: DemoDataStamps): Promise<void> {
  await db.updateOne(DEMO_DATA, DEMO_DATA_ROW, { ...stamps, modified: new Date() }, DIGITA.DATABASES.CORE);
}

export interface DemoDataDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  hookRunner: HookRunner;
  reseed: ReseedDeps;
  listPendingSetupRecords(): Promise<PendingSetupRecord[]>;
}

/** The registered kind of this engine, which the reload of the definitions registers again. */
let enabledKind: DemoDataKind | undefined;

/** The definition this engine registered at boot, if any. */
export function findEnabledDemoDataDefinition(): EntityDefinition | undefined {
  return enabledKind ? demoDataDefinition(enabledKind) : undefined;
}

/** The kind this engine registered at boot, if any. */
export function findEnabledDemoDataKind(): DemoDataKind | undefined {
  return enabledKind;
}

/** Register the entity, its row and the handlers of its operations. */
export async function enableDemoData(deps: DemoDataDeps, kind: DemoDataKind): Promise<void> {
  const { db, registry, hookRunner } = deps;
  await new SchemaMigrator(db).removeRetiredEntity({ name: RETIRED_DEMO_RESET, database: DIGITA.DATABASES.CORE });
  registry.register(demoDataDefinition(kind));
  enabledKind = kind;

  await db.ensureCollection(DEMO_DATA, DIGITA.DATABASES.CORE);
  if (!(await db.findOne(DEMO_DATA, DEMO_DATA_ROW, DIGITA.DATABASES.CORE))) {
    const now = new Date();
    await db.insertOne(
      DEMO_DATA,
      { _id: DEMO_DATA_ROW, doctype: DEMO_DATA, docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now },
      DIGITA.DATABASES.CORE,
    );
  }

  // The handlers check the state again: the action route checks `show_if` against the row, but
  // neither the setup, nor the records, nor the typed id are on the row.
  const assertAppId = (services: HookServices | undefined) => {
    if (!env.APP_NAME || services?.actionParams?.["app_id"] !== env.APP_NAME) throw refuse.appId();
  };
  const actor = (services: HookServices | undefined) => services?.user?.email ?? "system";
  const run = async (operation: DemoDataOperation, demoTier: boolean, keepConfiguration: boolean) =>
    ({ done: true, result: await reseedAppData({ operation, demoTier, keepConfiguration }, deps.reseed) }) as { done: true; result: ReseedSummary };

  if (kind === "showcase") {
    hookRunner.registerAction(DEMO_DATA, "reset", async (_doc: BaseDocument, _ctx, services) => {
      assertAppId(services);
      const result = await run("reset", env.SEED_DEMO_DATA_ON_BOOT, false);
      if (env.SEED_DEMO_DATA_ON_BOOT) await stamp(db, { loaded_at: new Date(), loaded_by: actor(services) });
      return result;
    });
    return;
  }

  hookRunner.registerAction(DEMO_DATA, "load", async (_doc: BaseDocument, _ctx, services) => {
    if (isLoaded(await readDemoDataStamps(db))) throw refuse.loaded();
    if ((await deps.listPendingSetupRecords()).length > 0) throw new SetupIncompleteError();
    const unseeded = await listUnseededRecords(db, registry);
    if (unseeded.length > 0) throw refuse.records(unseeded.reduce((sum, c) => sum + c.count, 0));
    const result = await run("load", true, true);
    await stamp(db, { loaded_at: new Date(), loaded_by: actor(services) });
    return result;
  });
  hookRunner.registerAction(DEMO_DATA, "reset", async (_doc: BaseDocument, _ctx, services) => {
    if (!isLoaded(await readDemoDataStamps(db))) throw refuse.notLoaded();
    assertAppId(services);
    const result = await run("reset", true, true);
    await stamp(db, { loaded_at: new Date(), loaded_by: actor(services) });
    return result;
  });
  hookRunner.registerAction(DEMO_DATA, "remove", async (_doc: BaseDocument, _ctx, services) => {
    if (!isLoaded(await readDemoDataStamps(db))) throw refuse.notLoaded();
    assertAppId(services);
    const result = await run("remove", false, true);
    await stamp(db, { removed_at: new Date(), removed_by: actor(services) });
    return result;
  });
}

/** On an engine without demo data, remove what an earlier boot stored of it and of the entity it replaced. */
export async function removeDemoData(db: MongoDBService): Promise<void> {
  enabledKind = undefined;
  const migrator = new SchemaMigrator(db);
  await migrator.removeRetiredEntity({ name: DEMO_DATA, database: DIGITA.DATABASES.CORE });
  await migrator.removeRetiredEntity({ name: RETIRED_DEMO_RESET, database: DIGITA.DATABASES.CORE });
}

/**
 * Whether a boot with the demo tier switched on loads it: only into an app where it never was
 * loaded nor removed, and where nobody has created a record. The tick box alone never loads it
 * between a tenant's own records, and a removal holds across restarts.
 */
export async function shouldBootLoadDemoTier(db: MongoDBService, registry: EntityRegistry): Promise<boolean> {
  const stamps = await readDemoDataStamps(db);
  if (stamps.loaded_at || stamps.removed_at) return false;
  return (await listUnseededRecords(db, registry)).length === 0;
}

/** Stamps a load the boot made, so the counts of changed records start with it. */
export async function stampBootLoad(db: MongoDBService): Promise<void> {
  await stamp(db, { loaded_at: new Date(), loaded_by: BOOT });
}
