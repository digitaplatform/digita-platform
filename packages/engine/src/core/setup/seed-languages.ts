import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-languages");

// The languages a tenant starts with, all ENABLED: exactly SUPPORTED_LANGUAGES of
// @digitaplatform/shared, the languages every build's texts in
// digitaplatform/digita-translations carry in full, so no language offered here
// lacks the engine's, the app's or the website's texts. A test fails when the two
// lists differ.
export const DEFAULT_LANGUAGES = [
  {
    _id: "en",
    name: "English",
    native_name: "English",
    direction: "ltr",
    flag_emoji: "\u{1F1EC}\u{1F1E7}",
    enabled: true,
    translation_coverage: 100,
    doctype: "language",
    docstatus: 0,
  },
  {
    _id: "tr",
    name: "Turkish",
    native_name: "T\u00fcrk\u00e7e",
    direction: "ltr",
    flag_emoji: "\u{1F1F9}\u{1F1F7}",
    enabled: true,
    translation_coverage: 0,
    doctype: "language",
    docstatus: 0,
  },
  {
    _id: "de",
    name: "German",
    native_name: "Deutsch",
    direction: "ltr",
    flag_emoji: "\u{1F1E9}\u{1F1EA}",
    enabled: true,
    translation_coverage: 0,
    doctype: "language",
    docstatus: 0,
  },
  {
    _id: "es",
    name: "Spanish",
    native_name: "Espa\u00f1ol",
    direction: "ltr",
    flag_emoji: "\u{1F1EA}\u{1F1F8}",
    enabled: true,
    translation_coverage: 0,
    doctype: "language",
    docstatus: 0,
  },
  {
    _id: "fr",
    name: "French",
    native_name: "Fran\u00e7ais",
    direction: "ltr",
    flag_emoji: "\u{1F1EB}\u{1F1F7}",
    enabled: true,
    translation_coverage: 0,
    doctype: "language",
    docstatus: 0,
  },
  {
    _id: "it",
    name: "Italian",
    native_name: "Italiano",
    direction: "ltr",
    flag_emoji: "\u{1F1EE}\u{1F1F9}",
    enabled: true,
    translation_coverage: 0,
    doctype: "language",
    docstatus: 0,
  },
];

export async function seedLanguages(db: MongoDBService): Promise<void> {
  await db.ensureCollection(DIGITA.COLLECTIONS.LANGUAGE, DIGITA.DATABASES.CORE);

  for (const lang of DEFAULT_LANGUAGES) {
    const existing = await db.findOne(DIGITA.COLLECTIONS.LANGUAGE, lang._id, DIGITA.DATABASES.CORE);
    if (!existing) {
      await db.insertOne(
        DIGITA.COLLECTIONS.LANGUAGE,
        {
          ...lang,
          owner: "system",
          modified_by: "system",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
      log.info({ language: lang._id, name: lang.name }, "Language seeded");
    }
  }
}
