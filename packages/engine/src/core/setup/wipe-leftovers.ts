import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { StoragePort } from "../storage/storage-port.js";
import { deleteFileRefCounted } from "../storage/file-cleanup.js";

/**
 * Deletes what the other databases hold of the records of `entities`, once a wipe has deleted
 * every one of them: their shares, versions, activity entries, view log, files with their stored
 * blobs, and data translations. The naming counters start again at 1 after a wipe, so a new
 * record takes the id of a wiped one, and without this it would inherit the wiped record's
 * shares, history and files.
 */
export async function deleteWipedRecordLeftovers(
  db: MongoDBService,
  storage: StoragePort,
  entities: string[],
): Promise<void> {
  if (entities.length === 0) return;
  const ofWiped = { entity: { $in: entities } };
  await db.deleteMany(DIGITA.COLLECTIONS.DOC_SHARE, ofWiped, DIGITA.DATABASES.IDENTITY);
  await db.deleteMany("_versions", ofWiped, DIGITA.DATABASES.AUDITS);
  await db.deleteMany(DIGITA.COLLECTIONS.LOG, ofWiped, DIGITA.DATABASES.LOGS);
  await db.deleteMany("_view_logs", ofWiped, DIGITA.DATABASES.LOGS);
  await db.deleteMany(DIGITA.COLLECTIONS.TRANSLATION, { namespace: "data", ...ofWiped }, DIGITA.DATABASES.CORE);
  const files = await db
    .collection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE)
    .find({ attached_to_entity: { $in: entities } }, { projection: { _id: 1 } })
    .toArray();
  for (const file of files) await deleteFileRefCounted(db, storage, String(file["_id"]));
}
