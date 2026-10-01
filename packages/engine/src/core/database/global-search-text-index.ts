import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "./mongodb-service.js";
import { runForwardMigrationOnce } from "./forward-migration.js";

const INDEX = "idx_global_search";
/** MongoDB's code for a collection that does not exist: it holds no index to drop. */
const NAMESPACE_NOT_FOUND = 26;

/**
 * A field's `in_global_search` built the text index `idx_global_search`, which no query read and
 * every write paid for. The key is gone, so the index leaves every entity's collection, once per
 * database.
 */
export async function dropGlobalSearchTextIndexOnce(
  db: MongoDBService,
  entities: EntityDefinition[],
): Promise<void> {
  await runForwardMigrationOnce(db, "drop-global-search-text-index", async () => {
    const dropped: string[] = [];
    for (const entity of entities) {
      const collection = db.collection(entity.name, entity.database);
      let names: Array<string | undefined>;
      try {
        names = (await collection.indexes()).map((i) => i.name);
      } catch (err) {
        if ((err as { code?: number }).code === NAMESPACE_NOT_FOUND) continue;
        throw err;
      }
      if (!names.includes(INDEX)) continue;
      await collection.dropIndex(INDEX);
      dropped.push(entity.name);
    }
    return { dropped };
  });
}
