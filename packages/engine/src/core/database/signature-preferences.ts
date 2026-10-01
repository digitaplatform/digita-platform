import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "./mongodb-service.js";
import { runForwardMigrationOnce } from "./forward-migration.js";

/**
 * A person could pick their own signature, kept as the UserPreference `ui.signature`. The tenant's
 * look, BrandingSetting.default_signature, replaced that pick, and nothing reads the row anymore,
 * so every such row is removed, once per database.
 */
export async function removeSignaturePreferencesOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "remove-signature-preferences", async () => ({
    removed: await db.deleteMany(
      DIGITA.COLLECTIONS.USER_PREFERENCE,
      { pref_key: "ui.signature" },
      DIGITA.DATABASES.CORE,
    ),
  }));
}
