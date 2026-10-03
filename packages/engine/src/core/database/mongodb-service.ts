import {
  MongoClient,
  Db,
  Collection,
  type Document,
  type Filter,
  type UpdateFilter,
  type FindOptions,
  type CreateIndexesOptions,
  type IndexSpecification,
  type WithId,
  type OptionalUnlessRequiredId,
  type ClientSession,
} from "mongodb";
import type { DatabaseTarget } from "@digitaplatform/shared";
import { DIGITA, activeRecordsFilter, activeRecordsPipeline } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { dbName } from "../config/db-names.js";
import { createLogger } from "../logging/logger.js";
import { mapOperatorToMongo } from "./filter-builder.js";
import { toIdString, toIdStorage, normalizeIdFilterValue } from "../document/id-codec.js";
import { ConfigurationError, EngineError } from "../errors/engine-error.js";

const log = createLogger("mongodb-service");

/**
 * Filter entry for `find()` / `count()`. Two equally-valid shapes:
 *
 *   1. Object-style — `{ field: value }` or `{ field: { $op: x } }`
 *      Each key is a field name; value is either a literal (equals match)
 *      or a native MongoDB operator expression.
 *
 *   2. Tuple-style — `[field, operator, value]`
 *      Operator is one of: `=`, `==`, `!=`, `<>`, `>`, `>=`, `<`, `<=`,
 *      `in`, `not in`, `like`, `not like`, `between`, `is`, `regex`, `exists`.
 *      Mapped by `mapOperatorToMongo` (filter-builder.ts), as the HTTP list route
 *      maps it; the values are compared as given, without the list route's date
 *      coercion.
 *
 * Both styles can be mixed in the same `filters` array. Each entry is
 * AND-merged into the final Mongo filter.
 *
 * Anything else throws `MalformedFilterError` — silent garbage filters
 * (e.g. nested arrays in the wrong shape, plain strings) cause empty
 * result sets, which is harder to debug than a thrown error.
 */
export type FilterEntry = Record<string, unknown> | [string, string, unknown];

/** Internal read control for restoration, retention and identity reservation. */
export interface ReadOptions {
  includeDeleted?: boolean;
}

export interface QueryOptions extends ReadOptions {
  filters?: FilterEntry[];
  fields?: string[];
  order_by?: string;
  limit?: number;
  offset?: number;
}

/** A filter entry that is neither a `{ field: value }` object nor a `[field, op, value]` tuple. */
export class MalformedFilterError extends EngineError {
  constructor() {
    super("filter_malformed", {}, 400, "MALFORMED_FILTER");
  }
}

/**
 * Thrown when the initial Mongo connection cannot be established. Carries
 * the redacted URI so the caller can format an actionable hint without
 * leaking credentials. The original driver error is attached as `cause`.
 */
export class MongoUnreachableError extends ConfigurationError {
  constructor(
    public readonly uri: string,
    cause: unknown,
  ) {
    super("database_unreachable", { uri });
    (this as { cause?: unknown }).cause = cause;
  }
}

export interface AppDatabaseDefinition {
  /** Logical target name as referenced by entity JSON `database` field. */
  name: string;
  /**
   * Physical Mongo DB name. Optional — if absent, derived from
   * `${MONGODB_APP_DB_PREFIX}_<name>` with `-` normalised to `_`.
   */
  physical?: string;
  /** Human-readable label (admin UI sidebar grouping, etc.). */
  label?: string;
  /** Free-form description for documentation. */
  description?: string;
}

export class MongoDBService {
  private client: MongoClient;
  private databases = new Map<DatabaseTarget, Db>();
  /** Registered application databases (logical name → physical Mongo DB name). */
  private appDatabases = new Map<string, AppDatabaseDefinition>();
  /** The work `afterCommit` queued, per session of a running `withTransaction`. */
  private commitWork = new WeakMap<ClientSession, Array<() => Promise<void>>>();
  private connected = false;

  constructor() {
    this.client = new MongoClient(env.MONGODB_URI, {
      minPoolSize: env.MONGODB_MIN_POOL,
      maxPoolSize: env.MONGODB_MAX_POOL,
      connectTimeoutMS: env.MONGODB_TIMEOUT_MS,
      retryWrites: env.MONGODB_RETRY_WRITES,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const startTime = Date.now();
    const redactedUri = env.MONGODB_URI.replace(/\/\/.*@/, "//<credentials>@");
    log.info({ uri: redactedUri }, "Connecting to MongoDB");

    try {
      await this.client.connect();
    } catch (err) {
      // Surface ECONNREFUSED / server-selection failures as a typed error so
      // the bootstrap can print an actionable hint instead of a 200-line
      // driver stack trace. Other errors propagate untouched.
      const e = err as { name?: string; code?: string };
      if (
        e?.name === "MongoServerSelectionError" ||
        e?.name === "MongoNetworkError" ||
        e?.code === "ECONNREFUSED"
      ) {
        throw new MongoUnreachableError(redactedUri, err);
      }
      throw err;
    }

    // Eagerly bind the four reserved targets. Application targets bind on
    // first use via `getDb` — that's how new domain DBs (master, accounting,
    // sales, …) appear without per-DB env-var ceremony.
    const reserved: Record<string, string> = {
      identity: env.MONGODB_IDENTITY_DB,
      logs: env.MONGODB_LOGS_DB,
      audits: env.MONGODB_AUDITS_DB,
      core: env.MONGODB_CORE_DB,
    };

    for (const [key, name] of Object.entries(reserved)) {
      this.databases.set(key, this.client.db(name));
      log.debug({ database: key, name }, "Database initialized");
    }

    this.connected = true;

    log.info(
      {
        duration_ms: Date.now() - startTime,
        databases: reserved,
        // The prefix only names databases the engine composes; a tenant engine composes none.
        ...(env.MONGODB_DATABASE_NAMES ? {} : { app_db_prefix: env.MONGODB_APP_DB_PREFIX }),
      },
      "MongoDB connected",
    );
  }

  /**
   * Resolve a logical target → physical Mongo DB name. Reserved names use
   * their dedicated env vars; everything else is treated as a domain
   * application database under the configured prefix.
   *
   * Mongo db names cannot contain `/\. "$*<>:|?` — `-` is allowed but we
   * normalise to `_` for predictable shell/diagnostic ergonomics.
   */
  private resolveDbName(target: string): string {
    if (target === "identity") return env.MONGODB_IDENTITY_DB;
    if (target === "logs") return env.MONGODB_LOGS_DB;
    if (target === "audits") return env.MONGODB_AUDITS_DB;
    if (target === "core") return env.MONGODB_CORE_DB;
    // A tenant engine opens only granted databases; every one is bound at connect or
    // registered from its grant, so reaching here means the grant lacks this target.
    if (env.MONGODB_DATABASE_NAMES) {
      throw new ConfigurationError("database_target_not_granted", { target });
    }
    const slug = target.replace(/-/g, "_").replace(/[^A-Za-z0-9_]/g, "_");
    if (!slug) {
      throw new ConfigurationError("database_target_invalid", { target });
    }
    // App/domain targets already embed the app name (discovery names them
    // `<app>_<domain>`, e.g. erp_sales), so ONLY the tenant GUID is injected —
    // passing APP_NAME too would double it (digita_<guid>_erp_erp_sales).
    // Reserved roles (core/logs/audits/identity) carry the app via env.ts.
    return dbName(env.MONGODB_APP_DB_PREFIX, env.TENANT_ID, "", slug, env.STAGE);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.databases.clear();
    this.connected = false;
    log.info("MongoDB disconnected");
  }

  /**
   * Register an application database (logical name → physical Mongo DB).
   * Reserved names (`identity`, `logs`, `audits`, `core`) cannot be re-registered.
   * Idempotent: re-registering the same logical name with the same physical
   * name is a no-op; conflicts throw.
   */
  registerAppDatabase(def: AppDatabaseDefinition): void {
    const name = def.name;
    if (name === "identity" || name === "logs" || name === "audits" || name === "core") {
      throw new ConfigurationError("database_target_reserved", { target: name });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new ConfigurationError("database_target_invalid", { target: name });
    }
    const physical = def.physical ?? this.resolveDbName(name);
    const existing = this.appDatabases.get(name);
    if (existing && existing.physical !== physical) {
      throw new ConfigurationError("database_target_remapped", { target: name, physical: String(existing.physical), requested: physical });
    }
    this.appDatabases.set(name, { ...def, physical });
    if (this.connected) {
      this.databases.set(name, this.client.db(physical));
      log.debug({ database: name, physical }, "Application database bound");
    }
  }

  /** Snapshot of currently registered application databases (logical view). */
  listAppDatabases(): AppDatabaseDefinition[] {
    return Array.from(this.appDatabases.values()).map((d) => ({ ...d }));
  }

  /**
   * Get a specific database by target key. Reserved targets bound at connect.
   * Application targets must have been registered via `registerAppDatabase`
   * (typically by the database-registry loader during boot). The very-fall-
   * back path resolves via the prefix env var so opportunistic platform-
   * internal calls (e.g. tests) keep working without explicit registration.
   */
  getDb(target: DatabaseTarget): Db {
    if (!this.connected) {
      throw new EngineError("database_not_connected", {}, 500, "INTERNAL_ERROR");
    }
    let db = this.databases.get(target);
    if (db) return db;
    if (target === "identity" || target === "logs" || target === "audits" || target === "core") {
      throw new EngineError("database_target_not_initialised", { target }, 500, "INTERNAL_ERROR");
    }
    const physical = this.appDatabases.get(target)?.physical ?? this.resolveDbName(target);
    db = this.client.db(physical);
    this.databases.set(target, db);
    return db;
  }

  /** Get a collection. Caller must always state the target DB explicitly. */
  collection(name: string, target: DatabaseTarget): Collection {
    return this.getDb(target).collection(name);
  }

  /**
   * Get the MongoDB client for session/transaction management.
   */
  getClient(): MongoClient {
    return this.client;
  }

  /**
   * Run a callback within a MongoDB transaction.
   * All operations using the returned session will be atomic.
   */
  async withTransaction<T>(callback: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        // The driver reruns the callback after a transient error, so work queued
        // by an attempt that aborted is dropped with it.
        this.commitWork.set(session, []);
        result = await callback(session);
      });
      for (const work of this.commitWork.get(session) ?? []) await work();
      return result!;
    } finally {
      this.commitWork.delete(session);
      await session.endSession();
    }
  }

  /**
   * Run `work` once the transaction of `session` has committed, and never when
   * it aborts: for effects no transaction can roll back, such as deleting a
   * stored file. The transaction has committed when `work` runs, so `work`
   * reports its own failures.
   */
  afterCommit(session: ClientSession, work: () => Promise<void>): void {
    const queue = this.commitWork.get(session);
    if (!queue) throw new EngineError("after_commit_without_transaction", {}, 500, "INTERNAL_ERROR");
    queue.push(work);
  }

  // ─── CRUD Operations ──────────────────────────────────

  /**
   * Normalize a document read from Mongo so its `_id` is always a string (a
   * native ObjectId → its 24-hex string). Keeps the pre-ObjectId contract for
   * every raw-document consumer (hooks, resolvers) that treats `_id` as a string.
   * Mutates and returns the same object. See docs/guides/id-concept.md.
   */
  private normalizeReadId<T extends Document | null>(doc: T): T {
    if (doc && (doc as Document)["_id"] != null) {
      (doc as Document)["_id"] = toIdString((doc as Document)["_id"]);
    }
    return doc;
  }

  async findOne(
    collectionName: string,
    id: string,
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<Document | null> {
    const result = await this.collection(collectionName, target).findOne(
      this.readFilter({ _id: toIdStorage(id) }, options),
      { session },
    );
    return this.normalizeReadId(result as Document | null);
  }

  async findOneByFilter(
    collectionName: string,
    filter: Filter<Document>,
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<Document | null> {
    const result = await this.collection(collectionName, target).findOne(this.readFilter(filter, options), { session });
    return this.normalizeReadId(result as Document | null);
  }

  async findManyByFilter(
    collectionName: string,
    filter: Filter<Document>,
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<Document[]> {
    const results = await this.collection(collectionName, target).find(this.readFilter(filter, options), { session }).toArray();
    return results.map((r) => this.normalizeReadId(r as Document)) as Document[];
  }

  async find(
    collectionName: string,
    options: QueryOptions = {},
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<Document[]> {
    const col = this.collection(collectionName, target);
    const filter = this.readFilter(this.buildMongoFilter(options.filters || []), options);
    const findOptions: FindOptions = { session };

    if (options.fields?.length) {
      findOptions.projection = Object.fromEntries(options.fields.map((f) => [f, 1]));
    }

    if (options.limit) {
      findOptions.limit = options.limit;
    }

    if (options.offset) {
      findOptions.skip = options.offset;
    }

    if (options.order_by) {
      findOptions.sort = this.parseOrderBy(options.order_by);
    }

    const results = await col.find(filter, findOptions).toArray();
    return results.map((r) => this.normalizeReadId(r as Document)) as Document[];
  }

  async insertOne(
    collectionName: string,
    data: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<void> {
    if (collectionName === DIGITA.COLLECTIONS.FILE && target === DIGITA.DATABASES.CORE) {
      if (!session) return this.withTransaction((tx) => this.insertOne(collectionName, data, target, tx));
      await this.guardFileBlobReferences([data], session);
    }
    await this.collection(collectionName, target).insertOne(
      data as OptionalUnlessRequiredId<Document>,
      { session },
    );
    log.debug({ collection: collectionName, db: target, id: data["_id"] }, "Document inserted");
  }

  async insertMany(
    collectionName: string,
    docs: Record<string, unknown>[],
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<void> {
    if (docs.length === 0) return;
    if (collectionName === DIGITA.COLLECTIONS.FILE && target === DIGITA.DATABASES.CORE) {
      if (!session) return this.withTransaction((tx) => this.insertMany(collectionName, docs, target, tx));
      await this.guardFileBlobReferences(docs, session);
    }
    await this.collection(collectionName, target).insertMany(
      docs as OptionalUnlessRequiredId<Document>[],
      { session, ordered: false },
    );
    log.debug(
      { collection: collectionName, db: target, count: docs.length },
      "Documents bulk-inserted",
    );
  }

  /**
   * `expected` pins stored values the write builds on: a row that no longer
   * holds them, because a save landed in between, is left as it is. Answers
   * whether a row matched, so a caller can count only what it wrote.
   */
  async updateOne(
    collectionName: string,
    id: string,
    changes: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
    expected: Record<string, unknown> = {},
  ): Promise<boolean> {
    const updateDoc: UpdateFilter<Document> = { $set: changes };
    if (collectionName === DIGITA.COLLECTIONS.FILE && target === DIGITA.DATABASES.CORE && ("storage_key" in changes || "thumbnail_key" in changes || "file_url" in changes)) {
      if (!session) return this.withTransaction((tx) => this.updateOne(collectionName, id, changes, target, tx, expected));
      await this.guardFileBlobReferences([changes], session);
    }
    const result = await this.collection(collectionName, target).updateOne(
      { _id: toIdStorage(id), ...expected } as unknown as Filter<Document>,
      updateDoc,
      { session },
    );
    log.debug({ collection: collectionName, db: target, id }, "Document updated");
    return result.matchedCount > 0;
  }

  /**
   * Update every row `filter` matches, with an update document (`$set`, `$inc`, ...) or an
   * aggregation pipeline, whose stages can compute a row's new value from its own fields.
   * Answers how many rows it changed.
   */
  async updateMany(
    collectionName: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown> | Record<string, unknown>[],
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.collection(collectionName, target).updateMany(
      filter as Filter<Document>,
      update as UpdateFilter<Document> | Document[],
      { session },
    );
    log.debug({ collection: collectionName, db: target, modified: result.modifiedCount }, "Documents updated");
    return result.modifiedCount;
  }

  /**
   * Insert-or-replace by `_id`. Used by setup/orchestrator paths that
   * need an idempotent write without going through the DocumentService
   * pipeline (no hooks, no validation, no version tracking). The supplied
   * `data` wholesale replaces the existing doc — caller is responsible
   * for carrying any preserved fields forward.
   */
  async upsertOne(
    collectionName: string,
    id: string,
    data: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
    expected?: Record<string, unknown>,
  ): Promise<boolean> {
    if (collectionName === DIGITA.COLLECTIONS.FILE && target === DIGITA.DATABASES.CORE) {
      if (!session) return this.withTransaction((tx) => this.upsertOne(collectionName, id, data, target, tx, expected));
      await this.guardFileBlobReferences([data], session);
    }
    const result = await this.collection(collectionName, target).replaceOne(
      { _id: toIdStorage(id), ...expected } as unknown as Filter<Document>,
      data as never,
      { upsert: expected === undefined, session },
    );
    log.debug({ collection: collectionName, db: target, id }, "Document upserted");
    return result.matchedCount > 0 || result.upsertedCount > 0;
  }

  private async guardFileBlobReferences(rows: readonly Record<string, unknown>[], session: ClientSession): Promise<void> {
    const keys = rows.flatMap((row) => [row["storage_key"], row["thumbnail_key"],
      typeof row["file_url"] === "string" && row["file_url"].startsWith("/uploads/") ? row["file_url"].split("/").at(-1) : undefined]);
    for (const key of [...new Set(keys.filter((key): key is string => typeof key === "string" && key.length > 0))].sort()) {
      await this.touchGuard(`blob:${key}`, session);
    }
  }

  async deleteOne(
    collectionName: string,
    id: string,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<void> {
    await this.collection(collectionName, target).deleteOne(
      { _id: toIdStorage(id) } as unknown as Filter<Document>,
      { session },
    );
    log.debug({ collection: collectionName, db: target, id }, "Document deleted");
  }

  async deleteMany(
    collectionName: string,
    filter: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.collection(collectionName, target).deleteMany(filter, { session });
    log.debug(
      { collection: collectionName, db: target, deleted: result.deletedCount },
      "Documents deleted",
    );
    return result.deletedCount;
  }

  async exists(
    collectionName: string,
    id: string,
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<boolean> {
    const count = await this.collection(collectionName, target).countDocuments(
      this.readFilter({ _id: toIdStorage(id) }, options),
      { limit: 1, session },
    );
    return count > 0;
  }

  /**
   * Existence check on an arbitrary field, not just `_id`. Used by the naming
   * self-heal loop (see naming-service.ts) to detect whether a freshly
   * generated key already belongs to an existing document — the checked
   * field may be `_id` itself or a separate business-key field, so this
   * stays generic rather than assuming `_id`.
   */
  async existsByField(
    collectionName: string,
    field: string,
    value: string,
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<boolean> {
    const filterValue = field === "_id" ? toIdStorage(value) : value;
    const count = await this.collection(collectionName, target).countDocuments(
      this.readFilter({ [field]: filterValue }, options),
      { limit: 1, session },
    );
    return count > 0;
  }

  async count(
    collectionName: string,
    filters: FilterEntry[],
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<number> {
    const filter = this.readFilter(this.buildMongoFilter(filters), options);
    return this.collection(collectionName, target).countDocuments(filter, { session });
  }

  async aggregate(
    collectionName: string,
    pipeline: Document[],
    target: DatabaseTarget,
    session?: ClientSession,
    options: ReadOptions = {},
  ): Promise<Document[]> {
    return this.collection(collectionName, target).aggregate(options.includeDeleted ? pipeline : activeRecordsPipeline(pipeline), { session }).toArray();
  }

  // ─── Index Management ─────────────────────────────────

  async createIndex(
    collectionName: string,
    spec: IndexSpecification,
    target: DatabaseTarget,
    options?: CreateIndexesOptions,
  ): Promise<string> {
    return this.collection(collectionName, target).createIndex(spec, options);
  }

  /** Refuse incompatible existing storage; return whether the ordinary collection exists. */
  async assertOrdinaryCollection(name: string, target: DatabaseTarget): Promise<boolean> {
    const db = this.getDb(target);
    const collections = await db.listCollections({ name }).toArray();
    if (collections.length > 0) {
      if (collections[0]!.type !== "collection") {
        throw new ConfigurationError("ordinary_collection_required", { collection: name });
      }
      return true;
    }
    return false;
  }

  async ensureCollection(name: string, target: DatabaseTarget): Promise<void> {
    if (await this.assertOrdinaryCollection(name, target)) return;
    await this.getDb(target).createCollection(name);
    log.info({ collection: name, db: target }, "Collection created");
  }

  async listCollections(target: DatabaseTarget): Promise<string[]> {
    const db = this.getDb(target);
    const collections = await db.listCollections().toArray();
    return collections.map((c) => c.name);
  }

  /**
   * Drop a collection. Destructive; only used by opt-in
   * PRUNE_ORPHAN_COLLECTIONS workflow.
   */
  async dropCollection(name: string, target: DatabaseTarget): Promise<boolean> {
    const db = this.getDb(target);
    return db.collection(name).drop().then(
      () => true,
      (err) => {
        // 26 = NamespaceNotFound — already gone.
        if ((err as { code?: number }).code === 26) return false;
        throw err;
      },
    );
  }

  // ─── Sequence (for naming) ──────────────────────────────

  async getNextSequence(
    sequenceName: string,
    field: string = "seq",
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.collection("_sequences", target).findOneAndUpdate(
      { _id: sequenceName } as unknown as Filter<Document>,
      { $inc: { [field]: 1 } as unknown as Record<string, number> },
      { upsert: true, returnDocument: "after", session },
    );

    return (result as unknown as Record<string, number>)[field]!;
  }

  async setSequenceValue(
    sequenceName: string,
    field: string,
    value: number,
    target: DatabaseTarget,
  ): Promise<void> {
    await this.collection("_sequences", target).updateOne(
      { _id: sequenceName } as unknown as Filter<Document>,
      { $set: { [field]: value } },
      { upsert: true },
    );
  }

  /**
   * Raise a sequence counter to at least `value` — never lowers it ($max).
   * Used to advance the naming counter past seeded ids without rewinding a live
   * counter that runtime inserts have already pushed higher (a re-seed must not
   * hand out already-used ids).
   */
  async setSequenceFloor(
    sequenceName: string,
    field: string,
    value: number,
    target: DatabaseTarget,
  ): Promise<void> {
    await this.collection("_sequences", target).updateOne(
      { _id: sequenceName } as unknown as Filter<Document>,
      { $max: { [field]: value } },
      { upsert: true },
    );
  }

  /**
   * Bump a per-document write-guard counter (upsert) inside the caller's transaction.
   * `cancel(doc)` and a concurrent `submit()` that links to the same doc both touch
   * the SAME guard key, so MongoDB serializes them via a write conflict on
   * `_doc_guards` — closing the cancel/submit write-skew (they otherwise write
   * disjoint business documents and never conflict, so both would commit under
   * snapshot isolation). `_doc_guards` lives in CORE and is ensured at boot
   * (transactions cannot create a collection).
   */
  async touchGuard(key: string, session: ClientSession): Promise<void> {
    await this.collection("_doc_guards", DIGITA.DATABASES.CORE).updateOne(
      { _id: key } as unknown as Filter<Document>,
      { $inc: { v: 1 } },
      { upsert: true, session },
    );
  }

  // ─── Helpers ───────────────────────────────────────────

  /**
   * Every entry is a condition of its own and all of them must hold, as in the
   * list route: two tuples on one field narrow the match instead of the second
   * replacing the first. A tuple's operator maps as the list route maps it.
   */
  private readFilter(filter: Record<string, unknown>, options: ReadOptions): Filter<Document> {
    return (options.includeDeleted ? filter : activeRecordsFilter(filter)) as Filter<Document>;
  }

  private buildMongoFilter(filters: FilterEntry[]): Filter<Document> {
    const conditions: Record<string, unknown>[] = [];

    for (const filter of filters) {
      // Form 1: top-level tuple [field, operator, value]
      if (Array.isArray(filter)) {
        if (filter.length !== 3 || typeof filter[0] !== "string" || typeof filter[1] !== "string") {
          throw new MalformedFilterError();
        }
        const [field, operator, value] = filter;
        conditions.push({ [field]: mapOperatorToMongo(operator, value) });
        continue;
      }

      // Form 2: object — `{field: value}` or `{field: {$op: x}}`. A value shaped like a tuple
      // stays a value of its key: read as a filter on the field it names, it would pass the
      // allow-list its key was checked against. Reject plain primitives and nulls.
      if (filter === null || typeof filter !== "object") {
        throw new MalformedFilterError();
      }
      if (Object.keys(filter).length > 0) conditions.push({ ...filter });
    }

    // Match `_id` queries against native ObjectIds (a 24-hex string → ObjectId).
    // Link-field filters are left as strings — only `_id` is stored as ObjectId.
    for (const condition of conditions) {
      if (condition["_id"] !== undefined) condition["_id"] = normalizeIdFilterValue(condition["_id"]);
    }

    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0] as Filter<Document>;
    return { $and: conditions } as Filter<Document>;
  }

  private parseOrderBy(orderBy: string): Record<string, 1 | -1> {
    const parts = orderBy.split(",").map((p) => p.trim());
    const sort: Record<string, 1 | -1> = {};

    for (const part of parts) {
      const [field, direction] = part.split(/\s+/);
      if (field) {
        sort[field] = direction?.toLowerCase() === "desc" ? -1 : 1;
      }
    }

    return sort;
  }
}
