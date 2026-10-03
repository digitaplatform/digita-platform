import type { MongoDBService } from "../database/mongodb-service.js";
import { runForwardMigrationOnce } from "../database/forward-migration.js";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-settings");

export async function seedSystemSettings(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE);

  const existing = await db.findOne(DIGITA.COLLECTIONS.SETTING, "settings", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
  if (!existing) {
    await db.insertOne(
      DIGITA.COLLECTIONS.SETTING,
      {
        _id: "settings",
        doctype: "settings",
        docstatus: 0,
        default_language: env.BOOTSTRAP_LOCALE,
        fallback_language: env.TRANSLATION_FALLBACK_LOCALE,
        allow_user_language: true,
        timezone: "UTC",
        deleted_retention_months: "12",
        owner: "system",
        modified_by: "system",
        creation: new Date(),
        modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );
    log.info("Settings seeded");
  }
}

/**
 * The settings row carried `is_first_run`, a flag for a setup wizard that no code ever read.
 * Whether an app is set up is now read from its settings records, so the field is gone and its
 * stored value is removed, once per database.
 */
export async function removeFirstRunFlagOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "remove-setting-first-run-flag", async () => ({
    removed: (
      await db
        .collection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE)
        .updateOne({ _id: "settings" as never }, { $unset: { is_first_run: "" } })
    ).modifiedCount,
  }));
}

/**
 * The platform's name was seeded into every tenant's settings and read as the brand where a tenant
 * set none. The brand is BrandingSetting.app_name alone, so nothing reads it any more: the stored
 * value is removed, once per database.
 */
export async function removePlatformNameOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "remove-setting-platform-name", async () => ({
    removed: (
      await db
        .collection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE)
        .updateOne({ _id: "settings" as never }, { $unset: { platform_name: "" } })
    ).modifiedCount,
  }));
}
