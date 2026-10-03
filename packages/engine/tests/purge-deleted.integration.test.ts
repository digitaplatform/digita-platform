import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: {
    NODE_ENV: "test", SERVICE_NAME: "digita-test", PORT: 0, HOST: "127.0.0.1",
    BASE_URL: "http://localhost:3000", API_PREFIX: "/api/v1",
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
    REDIS_URI: "redis://localhost:6379", REDIS_PREFIX: "test:", REDIS_PASSWORD: "",
    JWT_SECRET: "test-secret-key-at-least-32-chars-long", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL: "7d",
    PASSWORD_HASH_ROUNDS: 4, SESSION_MAX_AGE_SEC: 86400, MAX_LOGIN_ATTEMPTS: 5, LOGIN_LOCKOUT_SEC: 900,
    TOTP_ISSUER: "Test", TOTP_ENABLED: false,
    LOG_LEVEL: "error", LOG_PRETTY: false, LOG_TO_FILE: false, LOG_FILE_PATH: "./logs",
    LOG_REDACT_FIELDS: ["password", "secret", "token", "authorization"],
    BOOTSTRAP_LOCALE: "en", TRANSLATION_SOURCE: "file",
    TRANSLATION_SEED_ON_BOOT: false, TRANSLATION_FALLBACK_LOCALE: "en",
    API_RATE_LIMIT_MAX: 1000, API_RATE_LIMIT_WINDOW: "1m", API_MAX_BODY_SIZE: "10mb",
    API_TRUSTED_PROXY_HOPS: 0, API_PUBLIC_CREATE_RATE_LIMIT_MAX: 1000, API_PUBLIC_CREATE_RATE_LIMIT_WINDOW: 60000,
    API_PUBLIC_CREATE_MAX_BODY_SIZE: "16kb",
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    UPLOAD_MAX_SIZE: "25mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: "./uploads",
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf"],
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true,
    SEED_APP_DATA_ON_BOOT: false, SEED_DEMO_DATA_ON_BOOT: false,
    PASSWORD_FIELD_KEYS: "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", PASSWORD_FIELD_ACTIVE_KEY_ID: "k1",
  } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));
vi.mock("../src/core/cache/redis-service.js", () => ({
  RedisService: class {
    connect() { return Promise.resolve(); }
    disconnect() { return Promise.resolve(); }
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve(); }
    del() { return Promise.resolve(); }
  },
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { DIGITA, JOBS_CURSOR_PARAM } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import type { StoragePort } from "../src/core/storage/storage-port.js";
import { allVariantKeys } from "../src/core/storage/image-variants.js";
import { IndexManager } from "../src/core/database/index-manager.js";
import { mayReadFile, type FileAccessDeps } from "../src/core/storage/file-access.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let documentService: DocumentService;
let storage: StoragePort;

afterEach(() => vi.restoreAllMocks());
let registry: { register: (e: EntityDefinition) => void; getAll: () => EntityDefinition[]; get: (name: string) => EntityDefinition };

const adminUser = { _id: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] };
const monthsAgo = (m: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d;
};

const PURGE_BOOK: EntityDefinition = {
  name: "PurgeBook",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  track_changes: true,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", translatable: true },
    { fieldname: "attachment", fieldtype: "Attach", label: "Attachment" },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Bound Reader", level: 0, read: 1, if_owner: 1 },
  ],
} as unknown as EntityDefinition;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  registry = result.registry as unknown as typeof registry;
  registry.register(PURGE_BOOK);

  documentService = result.hookRunner.getServices()?.documentService as DocumentService;
  storage = (documentService as unknown as { storage: StoragePort }).storage;

  await db.ensureCollection(PURGE_BOOK.name, "app");
  await new IndexManager(db).ensureIndexes(PURGE_BOOK);

  await db.ensureCollection(DIGITA.COLLECTIONS.FILE, DIGITA.DATABASES.CORE);
  await new IndexManager(db).ensureIndexes(registry.get(DIGITA.COLLECTIONS.FILE));

  await db.ensureCollection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE);
  await new IndexManager(db).ensureIndexes(registry.get(DIGITA.COLLECTIONS.SETTING));

  await db.upsertOne(DIGITA.COLLECTIONS.SETTING, "Setting", {
    _id: "Setting",
    doctype: "Setting",
    deleted_retention_months: "12",
    default_language: "en",
    fallback_language: "en",
    owner: "admin@d",
    modified_by: "admin@d",
    creation: new Date(),
    modified: new Date(),
  }, DIGITA.DATABASES.CORE);
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("physical purge — storage failure, missing bytes, and retry (Priority 1)", () => {
  it("PLANTED DEFECT: storage deletion failure at StoragePort seam leaves marked File and parent for next-run retry", async () => {
    const parentId = "B-RETRY-FAIL";
    const fileId = "FILE-RETRY-FAIL";
    const mainKey = "books/fail-main.png";
    const thumbKey = "books/fail-thumb.png";

    await storage.put(mainKey, Buffer.from("image-content"), "image/png");
    await storage.put(thumbKey, Buffer.from("thumb-content"), "image/png");
    for (const vKey of allVariantKeys(mainKey)) {
      await storage.put(vKey, Buffer.from("variant"), "image/png");
    }

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      file_name: "fail.png",
      storage_key: mainKey,
      thumbnail_key: thumbKey,
      file_type: "image/png",
      file_url: `/api/v1/file/${fileId}/download`,
      attached_to_entity: "PurgeBook",
      attached_to_name: parentId,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: parentId,
      doctype: "PurgeBook",
      title: "Retry Book",
      attachment: `/api/v1/file/${fileId}/download`,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(14),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, "app");

    const deleteSpy = vi.spyOn(storage, "delete").mockRejectedValueOnce(new Error("Storage I/O failure at seam"));

    await expect(
      documentService.purgeDoc("PurgeBook", parentId, adminUser, { deletedBefore: new Date() }),
    ).rejects.toThrow("Storage I/O failure at seam");

    // Phase 1 committed: File doc is marked deleted as a durable retry pointer
    const retainedFile = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(retainedFile).not.toBeNull();
    expect(retainedFile?.["deleted"]).toBeInstanceOf(Date);
    expect(retainedFile?.["deleted_by"]).toBe("admin@d");

    // Parent document transaction rolled back: row still retained
    const retainedParent = await db.findOne("PurgeBook", parentId, "app", undefined, { includeDeleted: true });
    expect(retainedParent).not.toBeNull();
    expect(retainedParent?.["deleted"]).toBeInstanceOf(Date);

    // Storage bytes still intact
    expect(await storage.exists(mainKey)).toBe(true);
    expect(await storage.exists(thumbKey)).toBe(true);

    deleteSpy.mockRestore();

    // Next-run retry succeeds idempotently
    const retryResult = await documentService.purgeDoc("PurgeBook", parentId, adminUser, { deletedBefore: new Date() });
    expect(retryResult).toEqual({
      purged: true,
      files_deleted: 1,
      versions_deleted: 0,
      translations_deleted: 0,
    });

    expect(await db.findOne("PurgeBook", parentId, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();

    expect(await storage.exists(mainKey)).toBe(false);
    expect(await storage.exists(thumbKey)).toBe(false);
    for (const vKey of allVariantKeys(mainKey)) {
      expect(await storage.exists(vKey)).toBe(false);
    }
  });

  it("PLANTED DEFECT: thumbnail-delete failure after main bytes already gone leaves marked keys and parent for retry, and restore without bytes is refused", async () => {
    const parentId = "B-THUMB-FAIL";
    const fileId = "FILE-THUMB-FAIL";
    const mainKey = "books/thumb-fail-main.png";
    const thumbKey = "books/thumb-fail-thumb.png";

    await storage.put(mainKey, Buffer.from("main-content"), "image/png");
    await storage.put(thumbKey, Buffer.from("thumb-content"), "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      file_name: "thumb-fail.png",
      storage_key: mainKey,
      thumbnail_key: thumbKey,
      file_type: "image/png",
      file_url: `/api/v1/file/${fileId}/download`,
      attached_to_entity: "PurgeBook",
      attached_to_name: parentId,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: parentId,
      doctype: "PurgeBook",
      title: "Thumb Fail Parent",
      attachment: `/api/v1/file/${fileId}/download`,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(14),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, "app");

    // Main delete succeeds, but thumbnail delete fails
    const deleteBytes = storage.delete.bind(storage);
    const deleteSpy = vi.spyOn(storage, "delete").mockImplementation(async (key: string) => {
      if (key === thumbKey) throw new Error("Thumbnail delete exploded");
      await deleteBytes(key);
    });

    await expect(
      documentService.purgeDoc("PurgeBook", parentId, adminUser, { deletedBefore: new Date() }),
    ).rejects.toThrow("Thumbnail delete exploded");

    // Main bytes were deleted before failure
    expect(await storage.exists(mainKey)).toBe(false);
    // Thumbnail bytes remain
    expect(await storage.exists(thumbKey)).toBe(true);

    // Marked File and parent persist with durable pointer keys intact
    const fileDoc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(fileDoc).not.toBeNull();
    expect(fileDoc?.["deleted"]).toBeInstanceOf(Date);
    expect(fileDoc?.["storage_key"]).toBe(mainKey);
    expect(fileDoc?.["thumbnail_key"]).toBe(thumbKey);

    const parentDoc = await db.findOne("PurgeBook", parentId, "app", undefined, { includeDeleted: true });
    expect(parentDoc?.["deleted"]).toBeInstanceOf(Date);

    deleteSpy.mockRestore();

    // While bytes are missing (mainKey is gone), restoring this File record must be refused
    await expect(
      documentService.restoreDoc(DIGITA.COLLECTIONS.FILE, fileId, adminUser),
    ).rejects.toThrow();

    // Next retry succeeds idempotently: missing main key does not abort, thumb key is removed, metadata purged
    const retryResult = await documentService.purgeDoc("PurgeBook", parentId, adminUser, { deletedBefore: new Date() });
    expect(retryResult.purged).toBe(true);
    expect(retryResult.files_deleted).toBe(1);

    expect(await db.findOne("PurgeBook", parentId, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await storage.exists(thumbKey)).toBe(false);
  });

  it("PLANTED DEFECT: missing storage bytes succeed idempotently during purge", async () => {
    const parentId = "B-MISSING-BYTES";
    const fileId = "FILE-MISSING-BYTES";
    const missingKey = "books/non-existent-blob.png";

    if (await storage.exists(missingKey)) {
      await storage.delete(missingKey);
    }

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      file_name: "missing.png",
      storage_key: missingKey,
      file_type: "image/png",
      file_url: `/api/v1/file/${fileId}/download`,
      attached_to_entity: "PurgeBook",
      attached_to_name: parentId,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(13),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: parentId,
      doctype: "PurgeBook",
      title: "Missing Bytes Book",
      attachment: `/api/v1/file/${fileId}/download`,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(13),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, "app");

    const result = await documentService.purgeDoc("PurgeBook", parentId, adminUser, { deletedBefore: new Date() });
    expect(result.purged).toBe(true);
    expect(result.files_deleted).toBe(1);

    expect(await db.findOne("PurgeBook", parentId, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
  });
});

describe("physical purge — referenced File preservation across live and retained parents (Priority 2)", () => {
  it.each([true, false])("invalidates a shared File's old parent binding and later removes its bytes (current field: %s)", async (currentField) => {
    const suffix = currentField ? "CURRENT" : "REPLACED";
    const fileId = `FILE-BOUND-${suffix}`;
    const first = `B-BOUND-A-${suffix}`;
    const last = `B-BOUND-B-${suffix}`;
    const key = `books/bound-${suffix}.png`;
    const fileUrl = `/api/v1/file/${fileId}/download`;
    await storage.put(key, Buffer.from("shared original owner's bytes"), "image/png");
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, file_name: "shared.png", file_type: "image/png", storage_key: key,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: first,
      owner: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
    }, DIGITA.DATABASES.CORE);
    for (const [id, owner] of [[first, "original@d"], [last, "other@d"]]) {
      await db.insertOne("PurgeBook", {
        _id: id, title: id, owner, deleted_by: owner, deleted: monthsAgo(14),
        creation: monthsAgo(16), modified: monthsAgo(14),
        ...(id === last || currentField ? { attachment: fileUrl } : {}),
      }, "app");
    }
    const cutoff = { deletedBefore: monthsAgo(12) };
    expect(await documentService.purgeDoc("PurgeBook", first, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 0 });
    const retained = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(retained).toMatchObject({ attached_to_entity: null, attached_to_name: null, storage_key: key });
    expect(retained?.["deleted"]).toBeInstanceOf(Date);
    expect(await storage.exists(key)).toBe(true);
    await db.insertOne("PurgeBook", { _id: first, title: "Reused identity", owner: "new@d" }, "app");
    const deps = (documentService as unknown as { fileAccess(): FileAccessDeps }).fileAccess();
    const newOwner = { _id: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] };
    // Check the underlying parent grant too: clearing only File visibility would leave the stale binding.
    expect(await deps.permissionChecker.hasPermission(newOwner, "PurgeBook", "read", { _id: first, owner: "new@d" })).toMatchObject({ allowed: true });
    expect(await mayReadFile(deps, newOwner, retained!)).toBe(false);
    expect(await documentService.purgeDoc("PurgeBook", last, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 1 });
    expect(await storage.exists(key)).toBe(false);
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne("PurgeBook", first, "app")).toMatchObject({ owner: "new@d" });
  });

  it("PLANTED DEFECT: retained parent reference prevents File byte and metadata purge", async () => {
    const fileId = "FILE-RETAINED-PARENT-REF";
    const key = "books/retained-parent-ref.png";
    const dueParentId = "B-PARENT-DUE";
    const youngParentId = "B-PARENT-YOUNG";
    const fileUrl = `/api/v1/file/${fileId}/download`;

    await storage.put(key, Buffer.from("retained-bytes"), "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      file_name: "ref.png",
      storage_key: key,
      file_type: "image/png",
      file_url: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: dueParentId,
      doctype: "PurgeBook",
      title: "Due Book",
      attachment: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(14),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: youngParentId,
      doctype: "PurgeBook",
      title: "Young Retained Book",
      attachment: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(1),
      deleted_by: "admin@d",
      creation: monthsAgo(2),
      modified: monthsAgo(1),
    }, "app");

    const cutoff = monthsAgo(12);
    const result = await documentService.purgeDoc("PurgeBook", dueParentId, adminUser, { deletedBefore: cutoff });
    expect(result.purged).toBe(true);
    expect(result.files_deleted).toBe(0);

    expect(await db.findOne("PurgeBook", dueParentId, "app", undefined, { includeDeleted: true })).toBeNull();
    const preservedFile = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(preservedFile).not.toBeNull();
    expect(await storage.exists(key)).toBe(true);
  });

  it("PLANTED DEFECT: active parent reference prevents File purge", async () => {
    const fileId = "FILE-ACTIVE-PARENT-REF";
    const key = "books/active-parent-ref.png";
    const dueParentId = "B-PARENT-DUE-2";
    const liveParentId = "B-PARENT-LIVE";
    const fileUrl = `/api/v1/file/${fileId}/download`;

    await storage.put(key, Buffer.from("active-bytes"), "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      file_name: "live-ref.png",
      storage_key: key,
      file_type: "image/png",
      file_url: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: dueParentId,
      doctype: "PurgeBook",
      title: "Due Book 2",
      attachment: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(14),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: liveParentId,
      doctype: "PurgeBook",
      title: "Live Book",
      attachment: fileUrl,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(2),
      modified: monthsAgo(2),
    }, "app");

    const cutoff = monthsAgo(12);
    const result = await documentService.purgeDoc("PurgeBook", dueParentId, adminUser, { deletedBefore: cutoff });
    expect(result.purged).toBe(true);
    expect(result.files_deleted).toBe(0);

    expect(await db.findOne("PurgeBook", dueParentId, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).not.toBeNull();
    expect(await storage.exists(key)).toBe(true);
  });

  it("PLANTED DEFECT: deduplicated blob key referenced by another File record preserves storage bytes", async () => {
    const fileId1 = "FILE-DEDUP-PURGED";
    const fileId2 = "FILE-DEDUP-KEPT";
    const sharedKey = "shared/dedup-blob.png";

    await storage.put(sharedKey, Buffer.from("shared-blob"), "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId1,
      doctype: "File",
      file_name: "dedup1.png",
      storage_key: sharedKey,
      file_type: "image/png",
      file_url: `/api/v1/file/${fileId1}/download`,
      owner: "admin@d",
      modified_by: "admin@d",
      deleted: monthsAgo(14),
      deleted_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId2,
      doctype: "File",
      file_name: "dedup2.png",
      storage_key: sharedKey,
      file_type: "image/png",
      file_url: `/api/v1/file/${fileId2}/download`,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: monthsAgo(14),
      modified: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);

    const cutoff = monthsAgo(12);
    const result = await documentService.purgeDoc(DIGITA.COLLECTIONS.FILE, fileId1, adminUser, { deletedBefore: cutoff });
    expect(result.purged).toBe(true);

    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId1, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId2, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).not.toBeNull();
    expect(await storage.exists(sharedKey)).toBe(true);
  });
});

describe("physical purge — dependent data cleanup preserving neighboring rows (Priority 3)", () => {
  it("PLANTED DEFECT: purges _versions, data translations, and DocShare while preserving neighboring rows", async () => {
    const doc1 = "B-CLEAN-NEIGHBOR-1";
    const doc2 = "B-CLEAN-NEIGHBOR-2";

    await db.insertOne("PurgeBook", {
      _id: doc1, doctype: "PurgeBook", title: "Target Book",
      deleted: monthsAgo(14), deleted_by: "admin@d", owner: "admin@d", modified_by: "admin@d",
      creation: monthsAgo(14), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: doc2, doctype: "PurgeBook", title: "Neighbor Book",
      owner: "admin@d", modified_by: "admin@d",
      creation: monthsAgo(14), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("_versions", { _id: "v1-1", entity: "PurgeBook", document_name: doc1, version: 1, changes: [] }, DIGITA.DATABASES.AUDITS);
    await db.insertOne("_versions", { _id: "v1-2", entity: "PurgeBook", document_name: doc1, version: 2, changes: [] }, DIGITA.DATABASES.AUDITS);
    await db.insertOne("_versions", { _id: "v2-1", entity: "PurgeBook", document_name: doc2, version: 1, changes: [] }, DIGITA.DATABASES.AUDITS);

    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, {
      _id: `data:de:PurgeBook.${doc1}.title`, namespace: "data", entity: "PurgeBook",
      document_name: doc1, locale: "de", key: `PurgeBook.${doc1}.title`, value: "Ziel",
      source: "user", overridden: false, creation: new Date(), modified: new Date(),
    }, DIGITA.DATABASES.CORE);
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, {
      _id: `data:de:PurgeBook.${doc2}.title`, namespace: "data", entity: "PurgeBook",
      document_name: doc2, locale: "de", key: `PurgeBook.${doc2}.title`, value: "Nachbar",
      source: "user", overridden: false, creation: new Date(), modified: new Date(),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne(DIGITA.COLLECTIONS.DOC_SHARE, {
      _id: `PurgeBook:${doc1}:u1@d`, entity: "PurgeBook", document_name: doc1, shared_with: "u1@d",
      owner: "admin@d", creation: new Date(), modified: new Date(),
    }, DIGITA.DATABASES.IDENTITY);
    await db.insertOne(DIGITA.COLLECTIONS.DOC_SHARE, {
      _id: `PurgeBook:${doc2}:u2@d`, entity: "PurgeBook", document_name: doc2, shared_with: "u2@d",
      owner: "admin@d", creation: new Date(), modified: new Date(),
    }, DIGITA.DATABASES.IDENTITY);

    await db.insertOne("_view_logs", { _id: "vl-1", entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.LOGS);
    await db.insertOne("_view_logs", { _id: "vl-2", entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.LOGS);
    await db.insertOne(DIGITA.COLLECTIONS.LOG, { _id: "log-1", entity: "PurgeBook", document_name: doc1, action: "Viewed" }, DIGITA.DATABASES.LOGS);
    await db.insertOne(DIGITA.COLLECTIONS.LOG, { _id: "log-2", entity: "PurgeBook", document_name: doc2, action: "Viewed" }, DIGITA.DATABASES.LOGS);

    const result = await documentService.purgeDoc("PurgeBook", doc1, adminUser, { deletedBefore: monthsAgo(12) });
    expect(result.purged).toBe(true);
    expect(result.versions_deleted).toBe(2);
    expect(result.translations_deleted).toBe(1);

    expect(await db.findManyByFilter("_versions", { entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.AUDITS)).toHaveLength(0);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.TRANSLATION, { entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.CORE)).toHaveLength(0);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.DOC_SHARE, { entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.IDENTITY)).toHaveLength(0);
    expect(await db.findManyByFilter("_view_logs", { entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.LOGS)).toHaveLength(0);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.LOG, { entity: "PurgeBook", document_name: doc1 }, DIGITA.DATABASES.LOGS)).toHaveLength(0);

    expect(await db.findManyByFilter("_versions", { entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.AUDITS)).toHaveLength(1);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.TRANSLATION, { entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.CORE)).toHaveLength(1);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.DOC_SHARE, { entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.IDENTITY)).toHaveLength(1);
    expect(await db.findManyByFilter("_view_logs", { entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.LOGS)).toHaveLength(1);
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.LOG, { entity: "PurgeBook", document_name: doc2 }, DIGITA.DATABASES.LOGS)).toHaveLength(1);
  });
});

describe("physical purge — cutoff, Setting retention, and chunk cursor pagination (Priority 4)", () => {
  it("PLANTED DEFECT: enforces Setting deleted_retention_months in [12, 18, 24, 30] and accepts all positive policy cutoffs", async () => {
    // Rejects non-whitelisted values
    for (const invalid of ["6", "15", "36", "bad"]) {
      await db.updateOne(DIGITA.COLLECTIONS.SETTING, "Setting", { deleted_retention_months: invalid }, DIGITA.DATABASES.CORE);
      await expect(
        documentService.runAction("Setting", "Setting", "purge_deleted", adminUser),
      ).rejects.toThrow("Invalid deleted record retention");
    }

    // Accepts every positive policy value
    for (const valid of [12, 18, 24, 30]) {
      await db.updateOne(DIGITA.COLLECTIONS.SETTING, "Setting", { deleted_retention_months: String(valid) }, DIGITA.DATABASES.CORE);
      await expect(
        documentService.runAction("Setting", "Setting", "purge_deleted", adminUser),
      ).resolves.toMatchObject({ done: expect.any(Boolean) });
    }
  });

  it("PLANTED DEFECT: purges only due records, keeping live and young retained records intact across bounded execution", async () => {
    await db.updateOne(DIGITA.COLLECTIONS.SETTING, "Setting", { deleted_retention_months: "12" }, DIGITA.DATABASES.CORE);

    const dueId = "B-AGE-DUE";
    const liveId = "B-AGE-LIVE";
    const youngId = "B-AGE-YOUNG";

    await db.insertOne("PurgeBook", {
      _id: dueId, doctype: "PurgeBook", title: "Due For Purge",
      deleted: monthsAgo(14), deleted_by: "admin@d", owner: "admin@d", modified_by: "admin@d",
      creation: monthsAgo(14), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: liveId, doctype: "PurgeBook", title: "Live Active",
      owner: "admin@d", modified_by: "admin@d",
      creation: monthsAgo(14), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: youngId, doctype: "PurgeBook", title: "Young Deleted",
      deleted: monthsAgo(2), deleted_by: "admin@d", owner: "admin@d", modified_by: "admin@d",
      creation: monthsAgo(14), modified: monthsAgo(2),
    }, "app");

    // Execute purge targeting PurgeBook entity explicitly
    const startCursor = { entity: "PurgeBook", completed: 0, records: 0, files: 0, versions: 0, translations: 0 };
    let run = await documentService.runAction(
      "Setting", "Setting", "purge_deleted", adminUser, undefined,
      { [JOBS_CURSOR_PARAM]: JSON.stringify(startCursor) },
    ) as { done: boolean; cursor?: string };

    let iterations = 0;
    while (!run.done && iterations++ < registry.getAll().length + 2) {
      run = await documentService.runAction(
        "Setting", "Setting", "purge_deleted", adminUser, undefined,
        { [JOBS_CURSOR_PARAM]: run.cursor },
      ) as { done: boolean; cursor?: string };
    }

    expect(run.done).toBe(true);

    // Due record purged
    expect(await db.findOne("PurgeBook", dueId, "app", undefined, { includeDeleted: true })).toBeNull();
    // Live record preserved
    expect(await db.findOne("PurgeBook", liveId, "app")).not.toBeNull();
    // Young record preserved in retained state
    const youngDoc = await db.findOne("PurgeBook", youngId, "app", undefined, { includeDeleted: true });
    expect(youngDoc).not.toBeNull();
    expect(youngDoc?.["deleted"]).toBeInstanceOf(Date);
  });

  it.each([
    ["non-string cursor", { [JOBS_CURSOR_PARAM]: 12345 }],
    ["malformed json", { [JOBS_CURSOR_PARAM]: "{" }],
    ["unknown entity", { [JOBS_CURSOR_PARAM]: JSON.stringify({ entity: "UnknownEntity", completed: 0, records: 0, files: 0, versions: 0, translations: 0 }) }],
    ["negative counter", { [JOBS_CURSOR_PARAM]: JSON.stringify({ entity: "PurgeBook", completed: -1, records: 0, files: 0, versions: 0, translations: 0 }) }],
    ["non-string after", { [JOBS_CURSOR_PARAM]: JSON.stringify({ entity: "PurgeBook", after: 999, completed: 0, records: 0, files: 0, versions: 0, translations: 0 }) }],
  ])("PLANTED DEFECT: rejects invalid purge cursor (%s)", async (_label, payload) => {
    await expect(
      documentService.runAction("Setting", "Setting", "purge_deleted", adminUser, undefined, payload),
    ).rejects.toThrow();
  });

  it("PLANTED DEFECT: chunks entity rows at 100 with cursor pagination and purges File entities last", async () => {
    await db.updateOne(DIGITA.COLLECTIONS.SETTING, "Setting", { deleted_retention_months: "12" }, DIGITA.DATABASES.CORE);

    // Insert 105 deleted records for chunking verification
    const bulkDocs = [];
    for (let i = 1; i <= 105; i++) {
      bulkDocs.push({
        _id: `CHUNK-BOOK-${String(i).padStart(3, "0")}`,
        doctype: "PurgeBook",
        title: `Chunk ${i}`,
        deleted: monthsAgo(14),
        deleted_by: "admin@d",
        owner: "admin@d",
        modified_by: "admin@d",
        creation: monthsAgo(14),
        modified: monthsAgo(14),
      });
    }
    await db.insertMany("PurgeBook", bulkDocs, "app");

    // Chunk 1: starting from PurgeBook
    const chunk1State = {
      entity: "PurgeBook",
      completed: 0,
      records: 0,
      files: 0,
      versions: 0,
      translations: 0,
    };
    const res1 = await documentService.runAction(
      "Setting", "Setting", "purge_deleted", adminUser, undefined,
      { [JOBS_CURSOR_PARAM]: JSON.stringify(chunk1State) },
    ) as { done: boolean; cursor?: string; progress: { completed: number } };

    expect(res1.done).toBe(false);
    expect(res1.cursor).toBeDefined();
    expect(res1.progress.completed).toBe(100);

    const parsedCursor = JSON.parse(res1.cursor!) as { entity: string; after?: string; records: number };
    expect(parsedCursor.entity).toBe("PurgeBook");
    expect(parsedCursor.after).toBe("CHUNK-BOOK-100");
    expect(parsedCursor.records).toBe(100);

    // Chunk 2: resuming with cursor to complete PurgeBook
    const res2 = await documentService.runAction(
      "Setting", "Setting", "purge_deleted", adminUser, undefined,
      { [JOBS_CURSOR_PARAM]: res1.cursor },
    ) as { done: boolean; cursor?: string; progress: { completed: number } };

    const parsedCursor2 = res2.cursor ? JSON.parse(res2.cursor) as { entity: string; records: number; after?: string } : null;
    if (!res2.done && parsedCursor2) {
      expect(parsedCursor2.records).toBe(105);
      expect(parsedCursor2.after).toBeUndefined();
    }

    let next = res2;
    const visited: string[] = [];
    for (let remainingChunks = registry.getAll().length + 2; !next.done && remainingChunks > 0; remainingChunks--) {
      expect(next.cursor).toBeDefined();
      visited.push((JSON.parse(next.cursor!) as { entity: string }).entity);
      next = await documentService.runAction("Setting", "Setting", "purge_deleted", adminUser, undefined,
        { [JOBS_CURSOR_PARAM]: next.cursor }) as typeof res2;
    }
    expect(next.done).toBe(true);
    expect(visited.at(-1)).toBe(DIGITA.COLLECTIONS.FILE);

    const remaining = await db.count("PurgeBook", [{ _id: { $regex: "^CHUNK-BOOK-" } }], "app", undefined, { includeDeleted: true });
    expect(remaining).toBe(0);
  });
});
