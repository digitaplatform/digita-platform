import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-languages");

// Master language list. All six are ENABLED so the platform fully supports the
// languages the public website (digita-web) ships in: English, German, Italian,
// French, Spanish, Turkish. Rule: any language the frontend needs MUST exist
// (and be enabled) here \u2014 the engine is the master list. (Operator-UI chrome
// bundles exist for all six; the website carries its own per-page content
// translations.)
const DEFAULT_LANGUAGES = [
  {
    _id: "en",
    name: "English",
    native_name: "English",
    direction: "ltr",
    date_format: "MM/DD/YYYY",
    time_format: "hh:mm A",
    number_format: "#,###.##",
    first_day_of_week: "Sunday",
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
    date_format: "DD.MM.YYYY",
    time_format: "HH:mm",
    number_format: "#.###,##",
    first_day_of_week: "Monday",
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
    date_format: "DD.MM.YYYY",
    time_format: "HH:mm",
    number_format: "#.###,##",
    first_day_of_week: "Monday",
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
    date_format: "DD/MM/YYYY",
    time_format: "HH:mm",
    number_format: "#.###,##",
    first_day_of_week: "Monday",
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
    date_format: "DD/MM/YYYY",
    time_format: "HH:mm",
    number_format: "# ###,##",
    first_day_of_week: "Monday",
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
    date_format: "DD/MM/YYYY",
    time_format: "HH:mm",
    number_format: "#.###,##",
    first_day_of_week: "Monday",
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
