// Count, per app database, entity and required field, the stored documents with a blank value
// there, which any later update of such a document refuses (digita-platform engine, see
// src/core/setup/blank-required-count.ts). Read-only: it answers counts, never a value. It loads
// the app's definitions as the engine boots them, and blank means what the save refuses.
//
// Run it inside a tenant's engine pod, where the engine's built code and its settings are, by
// piping this file to node from a checkout of digita-platform:
//   kubectl exec -i -n <namespace> deploy/digita-engine -c engine -- \
//     node --input-type=module - < packages/engine/scripts/count-blank-required.mjs
import { MongoDBService } from "/app/packages/engine/dist/core/database/mongodb-service.js";
import { countBlankRequiredInApp } from "/app/packages/engine/dist/core/setup/blank-required-count.js";

const db = new MongoDBService();
await db.connect();
try {
  const counts = await countBlankRequiredInApp(db);
  console.log("database\tentity\tfield\tdocuments");
  for (const c of counts) console.log(`${c.database}\t${c.entity}\t${c.field}\t${c.documents}`);
  const blank = counts.filter((c) => c.documents > 0);
  console.log(`${counts.length} required fields counted, ${blank.length} with stored blank values`);
  console.log("A field required only through mandatory_depends_on is not counted.");
} finally {
  await db.disconnect();
}
