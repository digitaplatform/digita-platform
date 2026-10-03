import type { MongoDBService } from "../database/mongodb-service.js";
import { runForwardMigrationOnce } from "../database/forward-migration.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-branding");

/**
 * Initialize the BrandingSetting single. Singles are seeded (the engine surfaces
 * an uninitialized single as a loud 404, not an empty form), so the
 * "Appearance & Branding" page needs its row to exist. Only the defaulted fields
 * are written; the optional identity/theme/login fields stay unset and the boot
 * branding resolver falls back for them.
 */
export async function seedBrandingSettings(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.BRANDING_SETTING, DIGITA.DATABASES.CORE);

  const existing = await db.findOne(
    DIGITA.COLLECTIONS.BRANDING_SETTING,
    "branding",
    DIGITA.DATABASES.CORE,
    undefined,
    { includeDeleted: true },
  );
  if (!existing) {
    await db.insertOne(
      DIGITA.COLLECTIONS.BRANDING_SETTING,
      {
        _id: "branding",
        doctype: DIGITA.COLLECTIONS.BRANDING_SETTING,
        docstatus: 0,
        allow_user_theme_mode: true,
        owner: "system",
        modified_by: "system",
        creation: new Date(),
        modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );
    log.info("Branding settings seeded");
  }
}

/**
 * The seed used to write `density: "comfortable"` into every tenant's branding, a value nobody
 * chose. The tenant's density now applies to everyone without their own, so the seeded value is
 * cleared once per database; a density an Administrator set afterwards, or before as another
 * value, stays.
 */
export async function clearSeededDensityOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "clear-seeded-branding-density", async () => ({
    cleared: await db.updateOne(
      DIGITA.COLLECTIONS.BRANDING_SETTING,
      "branding",
      { density: null },
      DIGITA.DATABASES.CORE,
      undefined,
      { density: "comfortable" },
    ),
  }));
}
