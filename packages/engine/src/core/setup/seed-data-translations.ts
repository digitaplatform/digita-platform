import { readdir, readFile } from "fs/promises";
import { basename, join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "../database/mongodb-service.js";
import type { EntityRegistry } from "../entity/entity-registry.js";
import type { TranslationService } from "../i18n/translation-service.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("seed-data-translations");

/** Keys in a translation row that are NOT locale codes. */
const RESERVED = new Set(["_id", "field"]);

interface TranslationRow {
  _id?: unknown;
  field?: unknown;
  [localeOrMeta: string]: unknown;
}

/**
 * Seed per-document DATA translations from co-located files, so seeded master
 * data (chart of accounts, units, payment terms, …) displays in each user's UI
 * language. Generic + content-agnostic: the engine never learns which entity.
 *
 * File naming mirrors the data seeds — basename IS the entity `name`:
 *   `<appDir>/seeds/<EntityName>.translations.json`
 *   `<appDir>/<domain>/seeds/<EntityName>.translations.json`
 *
 * Format: a JSON array of rows, each naming a document + field plus one value
 * per locale (only declared-`translatable` fields are accepted):
 *   [{ "_id": "1200", "field": "name", "de": "Forderungen…", "fr": "Créances…" }]
 *
 * Always NON-DESTRUCTIVE: a translation whose id already exists is skipped, so
 * admin edits survive. Seeds are written with `source: "file"`; the admin
 * reload-definitions path drops `source:"file"` rows then re-seeds (file-
 * authoritative there). Never throws fatally — a bad file logs and is skipped.
 */
export async function seedDataTranslations(
  db: MongoDBService,
  registry: EntityRegistry,
  translationService: TranslationService,
  seedDirs: string[],
): Promise<void> {
  for (const dir of seedDirs) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".translations.json"));
    } catch {
      continue; // dir doesn't exist — nothing to seed
    }

    for (const file of files) {
      const entityName = basename(file, ".translations.json");
      if (!registry.has(entityName)) {
        log.error(
          { file: join(dir, file), entity: entityName },
          "data-translation seed skipped: no registered entity matches this filename",
        );
        continue;
      }

      let rows: TranslationRow[];
      try {
        const parsed = JSON.parse(await readFile(join(dir, file), "utf-8"));
        if (!Array.isArray(parsed)) throw new Error("top-level JSON must be an array");
        rows = parsed as TranslationRow[];
      } catch (e) {
        log.error(
          { file: join(dir, file), err: (e as Error).message },
          "data-translation seed parse failed",
        );
        continue;
      }

      const translatable = new Set(registry.getTranslatableFields(entityName));
      let inserted = 0;
      let skipped = 0;

      for (const row of rows) {
        const docName = row._id != null ? String(row._id) : undefined;
        const field = row.field != null ? String(row.field) : undefined;
        if (!docName || !field) {
          log.warn({ file, entity: entityName }, "data-translation row missing _id/field — skipped");
          continue;
        }
        if (!translatable.has(field)) {
          log.warn(
            { entity: entityName, field },
            "data-translation field is not declared translatable — skipped",
          );
          continue;
        }

        for (const [locale, value] of Object.entries(row)) {
          if (RESERVED.has(locale)) continue;
          if (typeof value !== "string" || !value.trim()) continue;
          const _id = `data:${locale}:${entityName}.${docName}.${field}`;
          const existing = await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, _id, DIGITA.DATABASES.CORE);
          if (existing) {
            skipped++;
            continue;
          }
          await translationService.setTranslation({
            namespace: "data",
            locale,
            key: `${entityName}.${docName}.${field}`,
            value,
            user: "system",
            entity: entityName,
            document_name: docName,
            fieldname: field,
            source: "file",
          });
          inserted++;
        }
      }

      log.info({ entity: entityName, inserted, skipped }, "seed-data-translations");
    }
  }
}
