import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "./mongodb-service.js";

/** A forward data migration that ran on a database leaves its row here, so it runs once. */
const MIGRATIONS = "_migrations";

/** Run `migrate` once per database; its row in `_migrations` keeps when it ran and what it reports. */
export async function runForwardMigrationOnce(
  db: MongoDBService,
  id: string,
  migrate: () => Promise<object>,
): Promise<void> {
  if (await db.findOne(MIGRATIONS, id, DIGITA.DATABASES.CORE)) return;
  const report = await migrate();
  await db.upsertOne(MIGRATIONS, id, { ran_at: new Date(), ...report }, DIGITA.DATABASES.CORE);
}
