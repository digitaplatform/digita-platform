import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-settings");

export async function seedSystemSettings(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE);

  const existing = await db.findOne(DIGITA.COLLECTIONS.SETTING, "settings", DIGITA.DATABASES.CORE);
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
        platform_name: "Digita Platform",
        timezone: "UTC",
        is_first_run: true,
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
