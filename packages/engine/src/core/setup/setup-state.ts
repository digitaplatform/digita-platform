import type { ClientSession } from "mongodb";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { ZodSchemaBuilder } from "../entity/zod-schema-builder.js";
import { validateEntityDataZod } from "../entity/entity-validator-zod.js";
import { EngineError } from "../errors/engine-error.js";

/** A settings record of an app that its own save would refuse as it is stored. */
export interface PendingSetupRecord {
  entity: EntityDefinition;
  /** The row as stored; undefined where none is stored. */
  row: Record<string, unknown> | undefined;
  /** The fields the save would refuse, in the order it names them; a cell of a Table row counts as its Table. */
  fields: string[];
}

export interface SetupStateDeps {
  db: MongoDBService;
  registry: EntityRegistry;
  zodSchemaBuilder: ZodSchemaBuilder;
}

/** Raised by a create in an app whose setup is not complete. */
export class SetupIncompleteError extends EngineError {
  constructor() {
    super("setup_incomplete", {}, 409, "SETUP_INCOMPLETE");
  }
}

const isAppDatabase = (db: MongoDBService, database: string): boolean =>
  db.listAppDatabases().some((d) => d.name === database);

/**
 * The settings records that keep this engine's apps from being set up: every `is_single` entity
 * of an app database whose stored row would not pass its own save. A seed stores a row without
 * validating it, so a required field the seed leaves empty is found here until a person fills it.
 * Nothing is stored for this state: it is read from the rows each time. The row is judged as it
 * is stored, not as a reader gets it: a read hides a Password, and a stored one is not missing.
 */
export async function listPendingSetupRecords(deps: SetupStateDeps, session?: ClientSession): Promise<PendingSetupRecord[]> {
  const pending: PendingSetupRecord[] = [];
  for (const entity of deps.registry.getAll()) {
    if (!entity.is_single || !isAppDatabase(deps.db, entity.database)) continue;
    const [row] = (await deps.db.find(entity.name, { limit: 1 }, entity.database, session)) as Record<string, unknown>[];
    const { errors } = validateEntityDataZod(entity, row ?? {}, deps.zodSchemaBuilder, false);
    if (errors.length === 0) continue;
    const fields = [...new Set(errors.map((error) => error.field.split(/[.[]/, 1)[0]!))];
    pending.push({ entity, row, fields });
  }
  return pending;
}

/**
 * Refuses the create of a record of `entity` while its app is not set up. A settings record
 * itself stays open, because saving it is the way out, and so does every entity outside the app
 * databases.
 */
export async function assertSetupAllowsCreate(entity: EntityDefinition, deps: SetupStateDeps, session?: ClientSession): Promise<void> {
  if (entity.is_single || !isAppDatabase(deps.db, entity.database)) return;
  // ponytail: reads each settings record on every create; cache per pod once an import measurably suffers.
  if ((await listPendingSetupRecords(deps, session)).length > 0) throw new SetupIncompleteError();
}
