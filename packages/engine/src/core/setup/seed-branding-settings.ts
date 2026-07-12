import type { MongoDBService } from "../database/mongodb-service.js";
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
  );
  if (!existing) {
    await db.insertOne(
      DIGITA.COLLECTIONS.BRANDING_SETTING,
      {
        _id: "branding",
        doctype: DIGITA.COLLECTIONS.BRANDING_SETTING,
        docstatus: 0,
        density: "comfortable",
        allow_user_template_override: true,
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
