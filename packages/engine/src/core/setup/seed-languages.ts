import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { createLogger } from "../logging/logger.js";
import { runForwardMigrationOnce } from "../database/forward-migration.js";

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
    const existing = await db.findOne(DIGITA.COLLECTIONS.LANGUAGE, lang._id, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    if (!existing) {
      // Language is named by its code, which it requires: the row's id is that code. The code is
      // unique, so a code another language holds is left out instead of stopping the start.
      const holder = await findCodeHolder(db, lang._id);
      await db.insertOne(
        DIGITA.COLLECTIONS.LANGUAGE,
        {
          ...lang,
          ...(holder ? {} : { code: lang._id }),
          owner: "system",
          modified_by: "system",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
      if (holder) log.warn({ language: lang._id, code_held_by: holder }, "Language seeded without its code, which another language holds");
      else log.info({ language: lang._id, name: lang.name }, "Language seeded");
    }
  }
  await fillLanguageCodesOnce(db);
}

/** The id of the language that holds a code, or undefined when none does. */
async function findCodeHolder(db: MongoDBService, code: string): Promise<string | undefined> {
  const holder = await db.findOneByFilter(DIGITA.COLLECTIONS.LANGUAGE, { code }, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
  return holder ? String(holder["_id"]) : undefined;
}

/**
 * The seed stored its languages without the code they are named by and that a save requires, so
 * no seeded language could be saved. The code is set from the id where it is blank, once per
 * database. A row whose code another language holds keeps its blank code and is named in the log
 * and in the migration row, so the start goes on and an Administrator gives one of them a code.
 */
export async function fillLanguageCodesOnce(db: MongoDBService): Promise<void> {
  await runForwardMigrationOnce(db, "fill-language-code", async () => {
    const blank = await db.findManyByFilter(
      DIGITA.COLLECTIONS.LANGUAGE,
      { $or: [{ code: { $exists: false } }, { code: null }, { code: "" }] },
      DIGITA.DATABASES.CORE,
    );
    let filled = 0;
    const unfilled: Array<{ language: string; code_held_by: string }> = [];
    for (const row of blank) {
      const code = String(row["_id"]);
      const holder = await findCodeHolder(db, code);
      if (holder) {
        unfilled.push({ language: code, code_held_by: holder });
        log.warn({ language: code, code_held_by: holder }, "Language left without its code, which another language holds");
        continue;
      }
      const updated = await db.updateOne(DIGITA.COLLECTIONS.LANGUAGE, code, { code }, DIGITA.DATABASES.CORE,
        undefined, { deleted: null });
      if (updated) filled++;
    }
    return { filled, unfilled };
  });
}
