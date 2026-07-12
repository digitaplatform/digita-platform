import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityRegistry } from "../entity/entity-registry.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-entity-definitions");

/**
 * Seed entity definitions from the registry (loaded from JSON files) into the
 * `entities` collection in MongoDB.
 *
 * The FILE is the single source of truth: definitions are authored in
 * `.entity.json` and arrive ONLY via deploy — there is no runtime schema editing
 * in the operator UI. So every boot RE-SEEDS each definition from the file,
 * overwriting the stored row. This is why a freshly-deployed field/prop appears
 * immediately, with no manual reload and no DB wipe — and why no per-field
 * "carry-forward" patches are needed (the DB always mirrors the files).
 * `firstRun` (which calls this) runs on every boot; its steps are idempotent.
 *
 * Full replace (delete + insert), NOT a partial $set — so a field REMOVED in the
 * file is also removed from the DB. `creation` is preserved across re-seeds.
 */
export async function seedEntityDefinitions(
  db: MongoDBService,
  registry: EntityRegistry,
): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.ENTITY, DIGITA.DATABASES.CORE);

  let inserted = 0;
  let reseeded = 0;
  for (const entity of registry.getAll()) {
    const existing = (await db.findOne(
      DIGITA.COLLECTIONS.ENTITY,
      entity.name,
      DIGITA.DATABASES.CORE,
    )) as Record<string, unknown> | null;
    const now = new Date();
    const dbDoc = {
      _id: entity.name,
      ...entity,
      owner: "system",
      modified_by: "system",
      creation: existing?.["creation"] ?? now,
      modified: now,
    };
    if (existing) {
      // Full replace so removed fields/props don't linger.
      await db.deleteOne(DIGITA.COLLECTIONS.ENTITY, entity.name, DIGITA.DATABASES.CORE);
      await db.insertOne(DIGITA.COLLECTIONS.ENTITY, dbDoc, DIGITA.DATABASES.CORE);
      reseeded++;
    } else {
      await db.insertOne(DIGITA.COLLECTIONS.ENTITY, dbDoc, DIGITA.DATABASES.CORE);
      inserted++;
      log.info({ entity: entity.name, module: entity.module }, "Entity definition seeded");
    }
  }
  if (reseeded > 0) {
    log.info(
      { reseeded, inserted },
      "Entity definitions re-seeded from files (file is the source of truth)",
    );
  }
}
