import type { DatabaseTarget, EntityDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import type { MongoDBService } from "./mongodb-service.js";
import { IndexManager } from "./index-manager.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("schema-migrator");

export interface MigrationResult {
  entity: string;
  collection_created: boolean;
  indexes_applied: boolean;
}

export interface OrphanCollectionReport {
  database: DatabaseTarget;
  collection: string;
  dropped: boolean;
}

export class SchemaMigrator {
  private indexManager: IndexManager;

  constructor(private db: MongoDBService) {
    this.indexManager = new IndexManager(db);
  }

  /**
   * Migrate a single entity: ensure collection exists and indexes are up to date.
   */
  async migrate(entity: EntityDefinition): Promise<MigrationResult> {
    const result: MigrationResult = {
      entity: entity.name,
      collection_created: false,
      indexes_applied: false,
    };

    // Skip virtual entities (no storage)
    if (entity.is_virtual) {
      log.debug({ entity: entity.name }, "Skipping virtual entity");
      return result;
    }

    // Ensure collection exists. When the entity declares `time_series`,
    // the collection is created as a native MongoDB time-series collection.
    // (Mongo cannot convert in place — `ensureCollection` throws clearly if
    // a non-timeseries collection of the same name already exists.)
    const dbTarget = entity.database;
    const existingCollections = await this.db.listCollections(dbTarget);

    if (!existingCollections.includes(entity.name)) {
      await this.db.ensureCollection(entity.name, dbTarget, {
        timeseries: entity.time_series,
      });
      result.collection_created = true;
      log.info({ entity: entity.name }, "Collection created");
    } else if (entity.time_series) {
      // Verify the existing collection is actually time-series; throws if not.
      await this.db.ensureCollection(entity.name, dbTarget, {
        timeseries: entity.time_series,
      });
    }

    // Apply indexes
    await this.indexManager.ensureIndexes(entity);
    result.indexes_applied = true;

    // Drop orphan indexes — those that exist in MongoDB but are not
    // declared by the current entity definition. Opt-in via
    // PRUNE_ORPHAN_INDEXES so the destructive drop happens only when
    // the operator has explicitly asked for it.
    if (env.PRUNE_ORPHAN_INDEXES) {
      await this.indexManager.pruneOrphanIndexes(entity);
    }

    // Initialize sequence if needed
    await this.initializeSequence(entity);

    return result;
  }

  /**
   * Migrate all entities.
   */
  async migrateAll(entities: EntityDefinition[]): Promise<MigrationResult[]> {
    log.info({ count: entities.length }, "Starting schema migration for all entities");
    const startTime = Date.now();

    // Ensure _sequences collection exists
    await this.db.ensureCollection("_sequences", DIGITA.DATABASES.CORE);
    // Ensure _doc_guards exists (cancel/submit write-skew guard — touched inside
    // transactions, which cannot create a collection).
    await this.db.ensureCollection("_doc_guards", DIGITA.DATABASES.CORE);

    const results: MigrationResult[] = [];
    for (const entity of entities) {
      const result = await this.migrate(entity);
      results.push(result);
    }

    // Orphan-collection sweep — visibility always, drop only on flag.
    const orphanReport = await this.sweepOrphanCollections(entities);
    if (orphanReport.length) {
      const dropped = orphanReport.filter((r) => r.dropped).length;
      log.warn(
        { count: orphanReport.length, dropped, items: orphanReport },
        env.PRUNE_ORPHAN_COLLECTIONS
          ? "Orphan collections found and dropped"
          : "Orphan collections found — set PRUNE_ORPHAN_COLLECTIONS=true to drop",
      );
    }

    const created = results.filter((r) => r.collection_created).length;
    const orphans = orphanReport.length;
    const dropped = orphanReport.filter((r) => r.dropped).length;
    // One-line operations summary — easier than scrolling through per-entity
    // log lines when verifying a fresh boot.
    log.info(
      {
        duration_ms: Date.now() - startTime,
        total: entities.length,
        created,
        orphans,
        dropped,
      },
      `Schema migration completed: ${entities.length} entities · ` +
        `${created} created · ` +
        `${orphans} orphan collections (${dropped} dropped)`,
    );

    return results;
  }

  /**
   * Walk every database that holds at least one registered entity, list
   * its collections, and report any that are not declared by any current
   * entity (and aren't internal `_*` book-keeping). When
   * PRUNE_ORPHAN_COLLECTIONS is on, drop them. Otherwise log only.
   *
   * Internal collections beginning with `_` (e.g. `_sequences`) and the
   * Mongo system collections (`system.*`) are always preserved.
   *
   * The IDENTITY database is excluded entirely: digita-auth owns it (User,
   * Session, LoginAudit, …) and the engine only declares a subset of its
   * collections (DocShare, Permission, Role). Since the User entity was
   * removed (ADR-12 P3), sweeping identity would flag — and with
   * PRUNE_ORPHAN_COLLECTIONS=true DROP — digita-auth's collections.
   */
  async sweepOrphanCollections(
    entities: EntityDefinition[],
  ): Promise<OrphanCollectionReport[]> {
    // Group expected collection names by database.
    const expectedByDb = new Map<DatabaseTarget, Set<string>>();
    for (const e of entities) {
      if (e.is_virtual) continue;
      let bucket = expectedByDb.get(e.database);
      if (!bucket) {
        bucket = new Set();
        expectedByDb.set(e.database, bucket);
      }
      bucket.add(e.name);
    }

    const reports: OrphanCollectionReport[] = [];
    for (const [dbTarget, expected] of expectedByDb) {
      // Never sweep the shared identity store — digita-auth owns it.
      if (dbTarget === DIGITA.DATABASES.IDENTITY) continue;
      let actual: string[];
      try {
        actual = await this.db.listCollections(dbTarget);
      } catch (err) {
        log.warn(
          { db: dbTarget, err: (err as Error).message },
          "Could not list collections — orphan sweep skipped for this database",
        );
        continue;
      }
      for (const coll of actual) {
        if (coll.startsWith("_") || coll.startsWith("system.")) continue;
        if (expected.has(coll)) continue;
        const report: OrphanCollectionReport = {
          database: dbTarget,
          collection: coll,
          dropped: false,
        };
        if (env.PRUNE_ORPHAN_COLLECTIONS) {
          try {
            const dropped = await this.db.dropCollection(coll, dbTarget);
            report.dropped = dropped;
          } catch (err) {
            log.error(
              { db: dbTarget, collection: coll, err: (err as Error).message },
              "Orphan collection drop failed",
            );
          }
        }
        reports.push(report);
      }
    }
    return reports;
  }

  private async initializeSequence(entity: EntityDefinition): Promise<void> {
    const dbTarget = entity.database;
    const seqDoc = await this.db.findOne("_sequences", entity.name, dbTarget);

    if (!seqDoc) {
      const namingStart = entity.naming.strategy === "auto_increment" ? 0 : 0;

      await this.db.insertOne(
        "_sequences",
        {
          _id: entity.name,
          naming_seq: namingStart,
        },
        dbTarget,
      );

      log.debug(
        { entity: entity.name, naming_start: namingStart },
        "Sequence initialized",
      );
    }
  }
}
