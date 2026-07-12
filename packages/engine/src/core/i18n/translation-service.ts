import { readdir, readFile } from "fs/promises";
import { DIGITA } from "@digitaplatform/shared";
import { join, basename } from "path";
import type { AnyBulkWriteOperation, Collection } from "mongodb";
import type { MongoDBService } from "../database/mongodb-service.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("translation-service");

/** Translation rows use a string business key as `_id` (namespace:locale:key), so the
 *  raw driver Collection (default `_id: ObjectId`) is narrowed for the batched seeders. */
type TranslationDoc = { _id: string } & Record<string, unknown>;

export class TranslationService {
  private cache: Map<string, string> = new Map();
  private fileTranslations: Map<string, Map<string, string>> = new Map();

  constructor(private db: MongoDBService) {}

  // ─── Core Translate ────────────────────────────────────

  async translate(key: string, locale: string, params?: Record<string, string>): Promise<string> {
    // 1. Try cache
    const cacheKey = `${locale}:${key}`;
    let value = this.cache.get(cacheKey);

    // 2. Try MongoDB (if source includes mongodb)
    if (!value && env.TRANSLATION_SOURCE !== "file") {
      const namespace = this.detectNamespace(key);
      const docId = `${namespace}:${locale}:${key}`;
      const doc = await this.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, docId, DIGITA.DATABASES.CORE);
      if (doc) {
        value = (doc as Record<string, unknown>)["value"] as string;
        this.cache.set(cacheKey, value);
      }
    }

    // 3. Try in-memory file translations
    if (!value) {
      value = this.fileTranslations.get(locale)?.get(key);
    }

    // 4. Fallback locale
    if (!value && locale !== env.TRANSLATION_FALLBACK_LOCALE) {
      return this.translate(key, env.TRANSLATION_FALLBACK_LOCALE, params);
    }

    // 5. Fallback to key itself
    if (!value) return this.interpolate(key, params);

    return this.interpolate(value, params);
  }


  // ─── Entity / Field Labels ─────────────────────────────

  async translateEntity(doctype: string, locale: string): Promise<string> {
    const result = await this.translate(`entity.${doctype}`, locale);
    return result === `entity.${doctype}` ? doctype : result;
  }

  async translateField(doctype: string, fieldname: string, locale: string): Promise<string> {
    const key = `field.${doctype}.${fieldname}`;
    const result = await this.translate(key, locale);
    return result === key ? fieldname : result;
  }

  async translateOption(
    doctype: string,
    fieldname: string,
    value: string,
    locale: string,
  ): Promise<string> {
    const key = `option.${doctype}.${fieldname}.${value}`;
    const result = await this.translate(key, locale);
    return result === key ? value : result;
  }

  /**
   * Scan all loaded entity definitions for Select fields and emit
   * `option.{Entity}.{fieldname}.{value}` keys with the raw value as the
   * default English label. Inserts only missing keys — existing translations
   * (including admin overrides) are preserved.
   */
  async seedOptionTranslationsFromEntities(
    entities: {
      name: string;
      fields: { fieldname: string; fieldtype?: string; options?: unknown }[];
    }[],
    fallbackLocale: string,
  ): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    if (env.TRANSLATION_SOURCE === "file") {
      return { inserted: 0, skipped: 0 };
    }

    // Collect every intended option-translation, resolve existence in ONE read,
    // then apply as ONE bulkWrite (was O(options) findOne+insert round trips).
    // Semantics preserved: insert only when absent, otherwise skip.
    const intended: { _id: string; key: string; value: string; entity: string; fieldname: string }[] = [];
    const seenIds = new Set<string>();
    for (const entity of entities) {
      for (const field of entity.fields) {
        if (field.fieldtype !== "Select") continue;
        if (!Array.isArray(field.options)) continue;

        for (const value of field.options) {
          if (typeof value !== "string" || !value) continue;
          const key = `option.${entity.name}.${field.fieldname}.${value}`;
          const _id = `entity:${fallbackLocale}:${key}`;
          if (seenIds.has(_id)) continue; // a duplicate option value would have been skipped by the old findOne too
          seenIds.add(_id);
          intended.push({ _id, key, value, entity: entity.name, fieldname: field.fieldname });
        }
      }
    }

    if (intended.length > 0) {
      const now = new Date();
      const col = this.db.collection(
        DIGITA.COLLECTIONS.TRANSLATION,
        DIGITA.DATABASES.CORE,
      ) as unknown as Collection<TranslationDoc>;
      const existing = new Set(
        (
          await col.find({ _id: { $in: intended.map((d) => d._id) } }, { projection: { _id: 1 } }).toArray()
        ).map((d) => d._id),
      );
      const ops: AnyBulkWriteOperation<TranslationDoc>[] = [];
      for (const d of intended) {
        if (existing.has(d._id)) {
          skipped++;
          continue;
        }
        ops.push({
          insertOne: {
            document: {
              _id: d._id,
              namespace: "entity",
              locale: fallbackLocale,
              key: d.key,
              value: d.value,
              source: "auto",
              overridden: false,
              entity: d.entity,
              fieldname: d.fieldname,
              creation: now,
              modified: now,
            },
          },
        });
        inserted++;
      }
      if (ops.length > 0) await col.bulkWrite(ops, { ordered: false });
    }

    log.info({ inserted, skipped }, "Option translations auto-seeded from entity definitions");
    return { inserted, skipped };
  }

  // ─── Data-Level Translations ───────────────────────────

  async resolveDocumentTranslations(
    entity: string,
    documentName: string,
    fields: string[],
    locale: string,
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    const docs = await this.db.find(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        filters: [
          {
            namespace: "data",
            entity,
            document_name: documentName,
            locale,
            fieldname: { $in: fields },
          },
        ],
      },
      DIGITA.DATABASES.CORE,
    );

    for (const doc of docs) {
      const d = doc as Record<string, unknown>;
      result[d["fieldname"] as string] = d["value"] as string;
    }

    return result;
  }

  /**
   * Fetch every data-level translation row for a single document, across all
   * locales and fields. Used by the admin Translations dialog to pre-fill
   * the editor with existing values.
   */
  async findDataTranslations(
    entity: string,
    documentName: string,
  ): Promise<Record<string, unknown>[]> {
    return this.db.find(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        filters: [
          {
            namespace: "data",
            entity,
            document_name: documentName,
          },
        ],
      },
      DIGITA.DATABASES.CORE,
    );
  }

  async resolveListTranslations(
    entity: string,
    documentNames: string[],
    fields: string[],
    locale: string,
  ): Promise<Map<string, Record<string, string>>> {
    const result = new Map<string, Record<string, string>>();

    if (documentNames.length === 0 || fields.length === 0) return result;

    const docs = await this.db.find(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        filters: [
          {
            namespace: "data",
            entity,
            document_name: { $in: documentNames },
            locale,
            fieldname: { $in: fields },
          },
        ],
      },
      DIGITA.DATABASES.CORE,
    );

    for (const doc of docs) {
      const d = doc as Record<string, unknown>;
      const docName = d["document_name"] as string;
      if (!result.has(docName)) result.set(docName, {});
      result.get(docName)![d["fieldname"] as string] = d["value"] as string;
    }

    return result;
  }

  // ─── Write Translations ────────────────────────────────

  async setTranslation(params: {
    namespace: "system" | "entity" | "data";
    locale: string;
    key: string;
    value: string;
    user: string;
    entity?: string;
    document_name?: string;
    fieldname?: string;
    module?: string;
    /** Origin of the value. Defaults: "user" for data (admin edit), "api"
     *  otherwise. Seed loaders pass "file" so admin edits ("user") win. */
    source?: "file" | "api" | "user";
  }): Promise<void> {
    const _id = `${params.namespace}:${params.locale}:${params.key}`;

    const existing = await this.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, _id, DIGITA.DATABASES.CORE);

    if (existing) {
      const existingData = existing as Record<string, unknown>;
      await this.db.updateOne(
        DIGITA.COLLECTIONS.TRANSLATION,
        _id,
        {
          value: params.value,
          overridden: existingData["source"] === "file",
          overridden_by: params.user,
          original_value: existingData["overridden"]
            ? existingData["original_value"]
            : existingData["value"],
          modified: new Date(),
          modified_by: params.user,
        },
        DIGITA.DATABASES.CORE,
      );
    } else {
      await this.db.insertOne(
        DIGITA.COLLECTIONS.TRANSLATION,
        {
          _id,
          namespace: params.namespace,
          locale: params.locale,
          key: params.key,
          value: params.value,
          source: params.source ?? (params.namespace === "data" ? "user" : "api"),
          overridden: false,
          entity: params.entity,
          document_name: params.document_name,
          fieldname: params.fieldname,
          module: params.module,
          owner: params.user,
          modified_by: params.user,
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
    }

    // Invalidate cache
    this.cache.delete(`${params.locale}:${params.key}`);
  }

  // ─── Seed from Files ───────────────────────────────────

  async seedFromFiles(localesDir: string): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0;
    let skipped = 0;

    let files: string[];
    try {
      const entries = await readdir(localesDir);
      files = entries.filter((f) => f.endsWith(".json"));
    } catch {
      // Optional probe: an app/domain legitimately ships no locales of its own
      // (system locales already cover the chrome). debug, not warn.
      log.debug({ dir: localesDir }, "Locales directory absent (skipped)");
      return { inserted: 0, skipped: 0 };
    }

    for (const file of files) {
      const locale = basename(file, ".json");
      const content = await readFile(join(localesDir, file), "utf-8");
      const translations: Record<string, string> = JSON.parse(content);

      // Store in memory for file-only mode
      if (!this.fileTranslations.has(locale)) {
        this.fileTranslations.set(locale, new Map());
      }
      const localeMap = this.fileTranslations.get(locale)!;

      const entries = Object.entries(translations);
      for (const [key, value] of entries) localeMap.set(key, value);

      // Also seed into MongoDB if source includes mongodb. Resolve existence in ONE
      // read + apply as ONE bulkWrite per file (was O(keys) findOne+insert/update
      // round trips). Semantics preserved exactly: insert when absent; update only a
      // non-overridden file row; skip an admin-overridden or non-file row.
      if (env.TRANSLATION_SOURCE === "file") continue;

      const now = new Date();
      const meta = entries.map(([key, value]) => {
        const namespace = this.detectNamespace(key);
        return { key, value, namespace, _id: `${namespace}:${locale}:${key}` };
      });
      const col = this.db.collection(
        DIGITA.COLLECTIONS.TRANSLATION,
        DIGITA.DATABASES.CORE,
      ) as unknown as Collection<TranslationDoc>;
      const existingById = new Map(
        (await col.find({ _id: { $in: meta.map((m) => m._id) } }).toArray()).map(
          (d) => [d._id, d as Record<string, unknown>] as const,
        ),
      );
      const ops: AnyBulkWriteOperation<TranslationDoc>[] = [];
      for (const m of meta) {
        const existing = existingById.get(m._id);
        if (!existing) {
          ops.push({
            insertOne: {
              document: {
                _id: m._id,
                namespace: m.namespace,
                locale,
                key: m.key,
                value: m.value,
                source: "file",
                overridden: false,
                creation: now,
                modified: now,
              },
            },
          });
          inserted++;
        } else if (existing["source"] === "file" && !existing["overridden"]) {
          ops.push({
            updateOne: { filter: { _id: m._id }, update: { $set: { value: m.value, modified: now } } },
          });
          inserted++;
        } else {
          skipped++;
        }
      }
      if (ops.length > 0) await col.bulkWrite(ops, { ordered: false });
    }

    log.info({ inserted, skipped }, "Translations seeded from files");
    return { inserted, skipped };
  }

  /**
   * Preload all translations for a locale into cache.
   */
  async loadTranslationsForLocale(locale: string): Promise<void> {
    if (env.TRANSLATION_SOURCE === "file") return;

    const docs = await this.db.find(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        filters: [{ locale }],
      },
      DIGITA.DATABASES.CORE,
    );

    for (const doc of docs) {
      const d = doc as Record<string, unknown>;
      this.cache.set(`${locale}:${d["key"]}`, d["value"] as string);
    }

    log.debug({ locale, count: docs.length }, "Translations cached for locale");
  }

  // ─── Coverage ──────────────────────────────────────────

  async getCoverage(
    locale: string,
  ): Promise<{ total: number; translated: number; percent: number }> {
    const fallback = env.TRANSLATION_FALLBACK_LOCALE;
    const totalKeys = await this.db.count(
      DIGITA.COLLECTIONS.TRANSLATION,
      [{ namespace: "system", locale: fallback }],
      DIGITA.DATABASES.CORE,
    );
    const translatedKeys = await this.db.count(
      DIGITA.COLLECTIONS.TRANSLATION,
      [{ namespace: "system", locale }],
      DIGITA.DATABASES.CORE,
    );

    const percent = totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 0;
    return { total: totalKeys, translated: translatedKeys, percent };
  }

  // ─── Public Query Methods (for translation router) ─────

  async findTranslations(
    filters: Record<string, unknown>[],
    limit?: number,
    offset?: number,
  ): Promise<Record<string, unknown>[]> {
    return (await this.db.find(DIGITA.COLLECTIONS.TRANSLATION, { filters, limit, offset }, DIGITA.DATABASES.CORE)) as Record<
      string,
      unknown
    >[];
  }

  async countTranslations(filters: Record<string, unknown>[]): Promise<number> {
    return this.db.count(DIGITA.COLLECTIONS.TRANSLATION, filters, DIGITA.DATABASES.CORE);
  }

  async findLanguages(
    filters: Record<string, unknown>[],
    fields?: string[],
  ): Promise<Record<string, unknown>[]> {
    return (await this.db.find(DIGITA.COLLECTIONS.LANGUAGE, { filters, fields }, DIGITA.DATABASES.CORE)) as Record<
      string,
      unknown
    >[];
  }

  async resetOverride(docId: string): Promise<boolean> {
    const existing = await this.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, docId, DIGITA.DATABASES.CORE);
    if (!existing) return false;
    const d = existing as Record<string, unknown>;
    if (d["overridden"] && d["original_value"]) {
      await this.db.updateOne(
        DIGITA.COLLECTIONS.TRANSLATION,
        docId,
        {
          value: d["original_value"],
          overridden: false,
          overridden_by: null,
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
      this.cache.delete(`${d["locale"]}:${d["key"]}`);
      return true;
    }
    return false;
  }

  // ─── Helpers ───────────────────────────────────────────

  private interpolate(text: string, params?: Record<string, string>): string {
    if (!params) return text;
    let result = text;
    for (const [key, value] of Object.entries(params)) {
      result = result.replaceAll(`{${key}}`, value);
    }
    return result;
  }

  private detectNamespace(key: string): string {
    if (key.startsWith("entity.") || key.startsWith("field.") || key.startsWith("option."))
      return "entity";
    return "system";
  }
}
