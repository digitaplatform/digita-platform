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
import type { DatabaseTarget, TimeSeriesConfig } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { dbName } from "../config/db-names.js";
import { createLogger } from "../logging/logger.js";
import { safeUserRegex } from "./filter-builder.js";
import { toIdString, toIdStorage, normalizeIdFilterValue } from "../document/id-codec.js";

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
 *      `in`, `not in`, `like`, `not like`, `between`, `is`, `regex`.
 *      Mirrors the format used by the HTTP resource-router (filter-builder.ts).
 *
 * Both styles can be mixed in the same `filters` array. Each entry is
 * AND-merged into the final Mongo filter.
 *
 * Anything else throws `MalformedFilterError` — silent garbage filters
 * (e.g. nested arrays in the wrong shape, plain strings) cause empty
 * result sets, which is harder to debug than a thrown error.
 */
export type FilterEntry = Record<string, unknown> | [string, string, unknown];

export interface QueryOptions {
  filters?: FilterEntry[];
  fields?: string[];
  order_by?: string;
  limit?: number;
  offset?: number;
}

export class MalformedFilterError extends Error {
  constructor(received: unknown) {
    super(
      `Malformed filter entry — expected { field: value } object or [field, op, value] tuple, got: ${JSON.stringify(received)}`,
    );
    this.name = "MalformedFilterError";
  }
}

/**
 * Thrown when the initial Mongo connection cannot be established. Carries
 * the redacted URI so the caller can format an actionable hint without
 * leaking credentials. The original driver error is attached as `cause`.
 */
export class MongoUnreachableError extends Error {
  public readonly uri: string;
  constructor(uri: string, cause: unknown) {
    super(`MongoDB unreachable at ${uri}`);
    this.name = "MongoUnreachableError";
    this.uri = uri;
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
  /**
   * Physical keys (`<target>::<collection>`) of collections ensured as native
   * MongoDB time-series collections. Populated by `ensureCollection` at boot.
   * A time-series collection CANNOT be written inside a multi-document
   * transaction (server code 263), so writes to these drop the txn session.
   */
  private timeSeriesCollections = new Set<string>();
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
        app_db_prefix: env.MONGODB_APP_DB_PREFIX,
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
    const slug = target.replace(/-/g, "_").replace(/[^A-Za-z0-9_]/g, "_");
    if (!slug) {
      throw new Error(`Invalid database target "${target}"`);
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
      throw new Error(
        `Cannot register reserved database target "${name}" — reserved names use their dedicated env vars`,
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`Invalid database target name "${name}"`);
    }
    const physical = def.physical ?? this.resolveDbName(name);
    const existing = this.appDatabases.get(name);
    if (existing && existing.physical !== physical) {
      throw new Error(
        `Database target "${name}" already registered as "${existing.physical}", cannot remap to "${physical}"`,
      );
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
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    let db = this.databases.get(target);
    if (db) return db;
    if (target === "identity" || target === "logs" || target === "audits" || target === "core") {
      throw new Error(`Reserved database target "${target}" not initialised`);
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
        result = await callback(session);
      });
      return result!;
    } finally {
      await session.endSession();
    }
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
  ): Promise<Document | null> {
    const result = await this.collection(collectionName, target).findOne(
      { _id: toIdStorage(id) } as unknown as Filter<Document>,
      { session },
    );
    return this.normalizeReadId(result as Document | null);
  }

  async findOneByFilter(
    collectionName: string,
    filter: Filter<Document>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<Document | null> {
    const result = await this.collection(collectionName, target).findOne(filter, { session });
    return this.normalizeReadId(result as Document | null);
  }

  async findManyByFilter(
    collectionName: string,
    filter: Filter<Document>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<Document[]> {
    const results = await this.collection(collectionName, target).find(filter, { session }).toArray();
    return results.map((r) => this.normalizeReadId(r as Document)) as Document[];
  }

  async find(
    collectionName: string,
    options: QueryOptions = {},
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<Document[]> {
    const col = this.collection(collectionName, target);
    const filter = this.buildMongoFilter(options.filters || []);
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

  /** Physical registry key for the time-series set. */
  private tsKey(name: string, target: DatabaseTarget): string {
    return `${target}::${name}`;
  }

  /** True if `name` in `target` was ensured as a native time-series collection. */
  isTimeSeries(name: string, target: DatabaseTarget): boolean {
    return this.timeSeriesCollections.has(this.tsKey(name, target));
  }

  /**
   * Pick the session to write with. A native MongoDB time-series collection
   * CANNOT be written inside a multi-document transaction — the server rejects
   * it with code 263 (OperationNotSupportedInTransaction), even at FCV 8.0. So
   * a time-series insert that lands inside an active transaction (stock/ledger
   * rows written from `on_submit` hooks that run in the submit txn) drops the
   * session and runs as a STANDALONE write, committing immediately outside the
   * txn. Trade-off (accepted): if the surrounding txn later aborts, that
   * append-only row is orphaned rather than rolled back — the submitted
   * document is the source of truth and the ledger row can be reconciled.
   * Every non-time-series write keeps the caller's session unchanged.
   */
  private sessionForWrite(
    name: string,
    target: DatabaseTarget,
    session?: ClientSession,
  ): ClientSession | undefined {
    if (session?.inTransaction() && this.isTimeSeries(name, target)) {
      log.debug(
        { collection: name, db: target },
        "Time-series write routed outside the active transaction",
      );
      return undefined;
    }
    return session;
  }

  async insertOne(
    collectionName: string,
    data: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<void> {
    await this.collection(collectionName, target).insertOne(
      data as OptionalUnlessRequiredId<Document>,
      { session: this.sessionForWrite(collectionName, target, session) },
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
    await this.collection(collectionName, target).insertMany(
      docs as OptionalUnlessRequiredId<Document>[],
      { session: this.sessionForWrite(collectionName, target, session), ordered: false },
    );
    log.debug(
      { collection: collectionName, db: target, count: docs.length },
      "Documents bulk-inserted",
    );
  }

  async updateOne(
    collectionName: string,
    id: string,
    changes: Record<string, unknown>,
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<void> {
    const updateDoc: UpdateFilter<Document> = { $set: changes };
    await this.collection(collectionName, target).updateOne(
      { _id: toIdStorage(id) } as unknown as Filter<Document>,
      updateDoc,
      { session },
    );
    log.debug({ collection: collectionName, db: target, id }, "Document updated");
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
  ): Promise<void> {
    await this.collection(collectionName, target).replaceOne(
      { _id: toIdStorage(id) } as unknown as Filter<Document>,
      data as never,
      { upsert: true, session },
    );
    log.debug({ collection: collectionName, db: target, id }, "Document upserted");
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
  ): Promise<boolean> {
    const count = await this.collection(collectionName, target).countDocuments(
      { _id: toIdStorage(id) } as unknown as Filter<Document>,
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
  ): Promise<boolean> {
    const filterValue = field === "_id" ? toIdStorage(value) : value;
    const count = await this.collection(collectionName, target).countDocuments(
      { [field]: filterValue } as unknown as Filter<Document>,
      { limit: 1, session },
    );
    return count > 0;
  }

  async count(
    collectionName: string,
    filters: FilterEntry[],
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<number> {
    const filter = this.buildMongoFilter(filters);
    return this.collection(collectionName, target).countDocuments(filter, { session });
  }

  async aggregate(
    collectionName: string,
    pipeline: Document[],
    target: DatabaseTarget,
    session?: ClientSession,
  ): Promise<Document[]> {
    return this.collection(collectionName, target).aggregate(pipeline, { session }).toArray();
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

  async ensureCollection(
    name: string,
    target: DatabaseTarget,
    options?: { timeseries?: TimeSeriesConfig },
  ): Promise<void> {
    const db = this.getDb(target);
    const collections = await db.listCollections({ name }).toArray();
    if (collections.length > 0) {
      // If a time-series flag is requested but the existing collection isn't
      // time-series, fail loud — Mongo doesn't support in-place conversion.
      if (options?.timeseries) {
        const info = collections[0] as { type?: string };
        if (info.type !== "timeseries") {
          throw new Error(
            `Collection "${name}" exists but is not a time-series collection. ` +
              `Time-series cannot be applied in place; drop and recreate.`,
          );
        }
        this.timeSeriesCollections.add(this.tsKey(name, target));
      }
      return;
    }
    if (options?.timeseries) {
      const ts = options.timeseries;
      const tsOpts: Record<string, unknown> = {
        timeField: ts.time_field,
      };
      if (ts.meta_field) tsOpts["metaField"] = ts.meta_field;
      if (ts.granularity) tsOpts["granularity"] = ts.granularity;
      const createOpts: Record<string, unknown> = { timeseries: tsOpts };
      if (ts.expire_after_seconds !== undefined) {
        createOpts["expireAfterSeconds"] = ts.expire_after_seconds;
      }
      await db.createCollection(name, createOpts as never);
      this.timeSeriesCollections.add(this.tsKey(name, target));
      log.info(
        { collection: name, db: target, timeseries: tsOpts },
        "Time-series collection created",
      );
      return;
    }
    await db.createCollection(name);
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

  private buildMongoFilter(filters: FilterEntry[]): Filter<Document> {
    if (!filters.length) return {};

    const mongoFilter: Record<string, unknown> = {};

    for (const filter of filters) {
      // Form 1: top-level tuple [field, operator, value]
      if (Array.isArray(filter)) {
        if (filter.length !== 3 || typeof filter[0] !== "string" || typeof filter[1] !== "string") {
          throw new MalformedFilterError(filter);
        }
        const [field, operator, val] = filter;
        mongoFilter[field] = this.mapOperator(operator, val);
        continue;
      }

      // Form 2: object — `{field: value}` or `{field: {$op: x}}`
      // Form 3 (legacy / tuple-as-value): `{anyKey: [field, op, val]}`
      // Reject plain primitives and nulls.
      if (filter === null || typeof filter !== "object") {
        throw new MalformedFilterError(filter);
      }

      const entries = Object.entries(filter);
      for (const [key, value] of entries) {
        if (
          Array.isArray(value) &&
          value.length === 3 &&
          typeof value[0] === "string" &&
          typeof value[1] === "string"
        ) {
          // Tuple-as-value: outer key is ignored, value is [field, op, val]
          const [field, operator, val] = value as [string, string, unknown];
          mongoFilter[field] = this.mapOperator(operator, val);
        } else {
          // Simple key-value: { status: "Active" } or { field: { $ne: x } }
          mongoFilter[key] = value;
        }
      }
    }

    // Match `_id` queries against native ObjectIds (a 24-hex string → ObjectId).
    // Link-field filters are left as strings — only `_id` is stored as ObjectId.
    if (mongoFilter["_id"] !== undefined) {
      mongoFilter["_id"] = normalizeIdFilterValue(mongoFilter["_id"]);
    }

    return mongoFilter as Filter<Document>;
  }

  private mapOperator(operator: string, value: unknown): unknown {
    switch (operator) {
      case "=":
      case "==":
        return value;
      case "!=":
      case "<>":
        return { $ne: value };
      case ">":
        return { $gt: value };
      case ">=":
        return { $gte: value };
      case "<":
        return { $lt: value };
      case "<=":
        return { $lte: value };
      case "in":
        return { $in: value };
      case "not in":
        return { $nin: value };
      case "like":
        return { $regex: this.likeToRegex(value as string), $options: "i" };
      case "not like":
        return { $not: { $regex: this.likeToRegex(value as string), $options: "i" } };
      case "between":
        if (Array.isArray(value) && value.length === 2) {
          return { $gte: value[0], $lte: value[1] };
        }
        return value;
      case "is":
        if (value === "set" || value === "not null") return { $ne: null };
        if (value === "not set" || value === "null") return null;
        return value;
      case "regex":
        return { $regex: safeUserRegex(value), $options: "i" };
      default:
        return value;
    }
  }

  private likeToRegex(pattern: string): string {
    // Convert SQL LIKE pattern to regex: % → .*, _ → .
    return pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".");
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
