import type { IndexSpecification, CreateIndexesOptions } from "mongodb";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "./mongodb-service.js";
import { createLogger } from "../logging/logger.js";
import { LAYOUT_FIELD_TYPES } from "@digitaplatform/shared";

const log = createLogger("index-manager");

export class IndexManager {
  constructor(private db: MongoDBService) {}

  /**
   * Ensure all indexes for an entity exist.
   * Creates standard indexes + entity-defined indexes + auto-indexes.
   */
  async ensureIndexes(entity: EntityDefinition): Promise<void> {
    const collectionName = entity.name;
    const dbTarget = entity.database;
    const indexes = this.buildIndexList(entity);

    for (const idx of indexes) {
      try {
        await this.db.createIndex(collectionName, idx.spec, dbTarget, idx.options);
        log.debug({ collection: collectionName, index: idx.options?.name }, "Index ensured");
      } catch (err: unknown) {
        const error = err as Error;
        // Index already exists with different options — skip
        if (error.message?.includes("already exists")) {
          log.debug(
            { collection: collectionName, index: idx.options?.name },
            "Index already exists, skipping",
          );
        } else {
          log.error(
            { collection: collectionName, index: idx.options?.name, err: error },
            "Failed to create index",
          );
        }
      }
    }
  }

  /**
   * Drop indexes on the collection that are NOT declared by the current
   * entity definition. Catches the case where a field gets removed from
   * `entity.indexes[]` or where a schema refactor removes the field
   * entirely (e.g. the `idx_table_id` left over after the table_id
   * removal). The default `_id_` MongoDB index is preserved.
   *
   * Opt-in via env flag (PRUNE_ORPHAN_INDEXES=true) — irreversible at
   * boot time, hence not the default.
   */
  async pruneOrphanIndexes(entity: EntityDefinition): Promise<string[]> {
    const collectionName = entity.name;
    const dbTarget = entity.database;
    const expected = new Set<string>(["_id_"]);
    for (const idx of this.buildIndexList(entity)) {
      if (idx.options?.name) expected.add(idx.options.name);
    }

    const collection = this.db.collection(collectionName, dbTarget);
    let existing: Array<{ name?: string }> = [];
    try {
      existing = (await collection.indexes()) as Array<{ name?: string }>;
    } catch (err) {
      // Collection may not exist yet (first boot) — nothing to prune.
      log.debug(
        { collection: collectionName, err: (err as Error).message },
        "Index list not available — skipping prune",
      );
      return [];
    }

    const dropped: string[] = [];
    for (const idx of existing) {
      const name = idx.name;
      if (!name || expected.has(name)) continue;
      try {
        await collection.dropIndex(name);
        dropped.push(name);
        log.warn({ collection: collectionName, index: name }, "Orphan index dropped");
      } catch (err) {
        log.error(
          { collection: collectionName, index: name, err: (err as Error).message },
          "Orphan index drop failed",
        );
      }
    }
    return dropped;
  }

  private buildIndexList(
    entity: EntityDefinition,
  ): Array<{ spec: IndexSpecification; options?: CreateIndexesOptions }> {
    const indexes: Array<{ spec: IndexSpecification; options?: CreateIndexesOptions }> = [];

    // Time-series collections in MongoDB don't support unique indexes (the
    // server rejects them at create time). Skip any field-level
    // `unique: true` for those entities — uniqueness makes little sense
    // for append-only event streams anyway.
    const isTimeSeries = !!entity.time_series;

    // 1. Standard indexes (every collection)
    indexes.push(
      { spec: { creation: -1 }, options: { name: "idx_creation" } },
      { spec: { modified: -1 }, options: { name: "idx_modified" } },
      { spec: { owner: 1 }, options: { name: "idx_owner" } },
    );

    if (entity.is_submittable) {
      indexes.push({ spec: { docstatus: 1 }, options: { name: "idx_docstatus" } });
    }

    // 2. Auto-index all Link fields
    for (const field of entity.fields) {
      if (field.fieldtype === "Link" && field.fieldname) {
        indexes.push({
          spec: { [field.fieldname]: 1 },
          options: { name: `idx_link_${field.fieldname}` },
        });
      }

      // Unique fields (skipped on time-series collections — Mongo rejects)
      if (!isTimeSeries && field.unique && !LAYOUT_FIELD_TYPES.includes(field.fieldtype)) {
        indexes.push({
          spec: { [field.fieldname]: 1 },
          options: { name: `idx_uniq_${field.fieldname}`, unique: true, sparse: true },
        });
      }
    }

    // 3. Text index for global search fields
    const textFields = entity.fields.filter(
      (f) => f.in_global_search && !LAYOUT_FIELD_TYPES.includes(f.fieldtype),
    );
    if (textFields.length > 0) {
      const textSpec: Record<string, string> = {};
      for (const f of textFields) {
        textSpec[f.fieldname] = "text";
      }
      indexes.push({
        spec: textSpec as IndexSpecification,
        options: { name: "idx_global_search" },
      });
    }

    // 4. Entity-defined custom indexes
    if (entity.indexes) {
      for (const idx of entity.indexes) {
        const spec: Record<string, unknown> = {};

        if (idx.type === "text") {
          for (const f of idx.fields) {
            spec[f] = "text";
          }
        } else if (idx.type === "2dsphere") {
          for (const f of idx.fields) {
            spec[f] = "2dsphere";
          }
        } else {
          for (const f of idx.fields) {
            spec[f] = 1;
          }
        }

        const options: CreateIndexesOptions = { name: idx.name };
        if (idx.unique) options.unique = true;
        if (idx.sparse) options.sparse = true;
        if (idx.expireAfterSeconds !== undefined) {
          options.expireAfterSeconds = idx.expireAfterSeconds;
        }

        indexes.push({ spec: spec as IndexSpecification, options });
      }
    }

    return indexes;
  }
}
