// Count, per app database, entity and required field, the stored documents with a blank value
// there, which any later update of such a document refuses (digita-platform engine, see
// src/core/setup/blank-required-count.ts). Read-only: it answers counts, never a value.
//
// Run it inside a tenant's engine pod, where the engine's built code and its database settings
// are, by piping this file to node from a checkout of digita-platform:
//   kubectl exec -i -n <namespace> deploy/digita-engine -c engine -- \
//     node --input-type=module - < packages/engine/scripts/count-blank-required.mjs
import { MongoDBService } from "/app/packages/engine/dist/core/database/mongodb-service.js";
import { EntityRegistry } from "/app/packages/engine/dist/core/entity/entity-registry.js";
import { countBlankRequired } from "/app/packages/engine/dist/core/setup/blank-required-count.js";

const db = new MongoDBService();
await db.connect();
try {
  const registry = new EntityRegistry();
  await registry.loadFromDb(db);
  const counts = await countBlankRequired(db, registry.getAll());
  console.log("database\tentity\tfield\tdocuments");
  for (const c of counts) console.log(`${c.database}\t${c.entity}\t${c.field}\t${c.documents}`);
  const blank = counts.filter((c) => c.documents > 0);
  console.log(`${counts.length} required fields counted, ${blank.length} with stored blank values`);
} finally {
  await db.disconnect();
}
