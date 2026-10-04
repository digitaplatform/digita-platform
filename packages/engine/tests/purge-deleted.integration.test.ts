import { vi, describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";

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
import type { ClientSession } from "mongodb";
import { toIdStorage } from "../src/core/document/id-codec.js";
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
let sign: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

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
    { role: "Bound Reader", level: 0, read: 1, create: 1, if_owner: 1 },
  ],
} as unknown as EntityDefinition;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  sign = ta.sign;
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
  async function expectDownloads(fileUrl: string, token: string, bytes?: [Buffer, Buffer]) {
    for (const [index, url] of [fileUrl, `${fileUrl}?thumb=1`].entries()) {
      const response = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(bytes ? 200 : 403);
      if (bytes) expect(Buffer.from(response.rawPayload).equals(bytes[index]!)).toBe(true);
    }
  }

  async function createAndReadReusedParent(name: string, token: string) {
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/PurgeBook", headers,
      payload: { _id: name },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ _id: name });
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/PurgeBook/${name}`, headers });
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toMatchObject({ _id: name });
    expect(await db.findOne("PurgeBook", name, "app")).toMatchObject({ owner: "new@d" });
  }

  it.each([[true, true], [false, true], [true, false]])("invalidates a shared File's old binding without blocking its existing reference (field: %s, retained: %s)", async (currentField, retainedParent) => {
    const suffix = `${currentField ? "CURRENT" : "REPLACED"}-${retainedParent ? "RETAINED" : "LIVE"}`;
    const fileId = `FILE-BOUND-${suffix}`;
    const first = `B-BOUND-A-${suffix}`;
    const last = `B-BOUND-B-${suffix}`;
    const key = `books/bound-${suffix}.png`;
    const thumbKey = `books/bound-${suffix}-thumb.png`;
    const fileUrl = `/api/v1/file/${fileId}/download`;
    const bytes: [Buffer, Buffer] = [Buffer.from("shared original owner's bytes"), Buffer.from("shared thumbnail bytes")];
    const [originalToken, adminToken, newToken] = await Promise.all([
      sign({ sub: "original@d", email: "original@d", roles: ["System User"] }),
      sign({ sub: adminUser._id, email: adminUser.email, roles: adminUser.roles }),
      sign({ sub: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] }),
    ]);
    await storage.put(key, bytes[0], "image/png");
    await storage.put(thumbKey, bytes[1], "image/png");
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, file_name: "shared.png", file_type: "image/png", storage_key: key,
      thumbnail_key: thumbKey, thumbnail_url: `${fileUrl}?thumb=1`,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: first,
      owner: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
    }, DIGITA.DATABASES.CORE);
    for (const [id, owner] of [[first, "original@d"], [last, "other@d"]]) {
      await db.insertOne("PurgeBook", {
        _id: id, title: id, owner,
        ...(id === first || retainedParent ? { deleted_by: owner, deleted: monthsAgo(14) } : {}),
        creation: monthsAgo(16), modified: monthsAgo(14),
        ...(id === last || currentField ? { attachment: fileUrl } : {}),
      }, "app");
    }
    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    await expectDownloads(fileUrl, newToken);
    const cutoff = { deletedBefore: monthsAgo(12) };
    expect(await documentService.purgeDoc("PurgeBook", first, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 0 });
    const retained = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(retained).toMatchObject({ attached_to_entity: "PurgeBook", attached_to_name: null, storage_key: key, thumbnail_key: thumbKey });
    expect(retained?.["deleted"] ?? null).toBeNull();
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.exists(thumbKey)).toBe(true);
    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    await createAndReadReusedParent(first, newToken);
    await expectDownloads(fileUrl, newToken);
    const deps = (documentService as unknown as { fileAccess(): FileAccessDeps }).fileAccess();
    const newOwner = { _id: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] };
    // Check the underlying parent grant too: clearing only File visibility would leave the stale binding.
    expect(await deps.permissionChecker.hasPermission(newOwner, "PurgeBook", "read", { _id: first, owner: "new@d" })).toMatchObject({ allowed: true });
    expect(await mayReadFile(deps, newOwner, retained!)).toBe(false);
    if (retainedParent) await documentService.restoreDoc("PurgeBook", last, adminUser);
    await documentService.update("PurgeBook", last, { title: "Editable existing reference" }, adminUser);
    expect(await db.findOne("PurgeBook", last, "app")).toMatchObject({ title: "Editable existing reference", attachment: fileUrl });
    const activeFile = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(activeFile).toMatchObject({ attached_to_name: null, storage_key: key, thumbnail_key: thumbKey });
    expect(activeFile?.["deleted"] ?? null).toBeNull();
    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    await expectDownloads(fileUrl, newToken);
    // This role may create the parent but cannot write its attachment field. The ignored
    // field must not become a stored reference or grant access to the colleague's File.
    const attempted = await documentService.insert("PurgeBook", {
      _id: `B-NEW-REFERENCE-${suffix}`, attachment: fileUrl,
    }, newOwner);
    const attemptedStored = await db.findOne("PurgeBook", attempted._id, "app");
    expect(attemptedStored).toMatchObject({ owner: newOwner.email });
    expect(attemptedStored?.["attachment"] ?? null).toBeNull();
    await expectDownloads(fileUrl, newToken);
    expect(await storage.exists(key)).toBe(true);
    await db.updateOne("PurgeBook", last, { deleted: monthsAgo(14), deleted_by: "other@d" }, "app");
    expect(await documentService.purgeDoc("PurgeBook", last, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 1 });
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.exists(thumbKey)).toBe(false);
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne("PurgeBook", first, "app")).toMatchObject({ owner: "new@d" });
  });

  it.each([false, true])("preserves a File restored between purge phases (previous marker: %s)", async (alreadyMarked) => {
    const suffix = alreadyMarked ? "PREV" : "NEW";
    const first = `B-RESTORED-BETWEEN-PHASES-${suffix}`;
    const fileId = `FILE-RESTORED-BETWEEN-PHASES-${suffix}`;
    const key = `books/restored-between-phases-${suffix}.png`;
    const thumbKey = `books/restored-between-phases-${suffix}-thumb.png`;
    const fileUrl = `/api/v1/file/${fileId}/download`;
    const bytes: [Buffer, Buffer] = [Buffer.from("restored main bytes"), Buffer.from("restored thumbnail bytes")];
    const [originalToken, adminToken, newToken] = await Promise.all([
      sign({ sub: "original@d", email: "original@d", roles: ["System User"] }),
      sign({ sub: adminUser._id, email: adminUser.email, roles: adminUser.roles }),
      sign({ sub: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] }),
    ]);
    await storage.put(key, bytes[0], "image/png");
    await storage.put(thumbKey, bytes[1], "image/png");
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, doctype: "File", docstatus: 0, file_name: "restored.png", file_type: "image/png",
      storage_key: key, thumbnail_key: thumbKey, thumbnail_url: `${fileUrl}?thumb=1`,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: first,
      owner: "original@d", modified_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
      ...(alreadyMarked ? { deleted: monthsAgo(14), deleted_by: "original@d" } : {}),
    }, DIGITA.DATABASES.CORE);
    await db.insertOne("PurgeBook", {
      _id: first, title: "Due parent", owner: "original@d", attachment: fileUrl,
      deleted: monthsAgo(14), deleted_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(14),
    }, "app");
    if (alreadyMarked) {
      for (const token of [originalToken, adminToken]) {
        for (const url of [fileUrl, `${fileUrl}?thumb=1`]) {
          expect((await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
        }
      }
    } else {
      for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    }

    const transact = db.withTransaction.bind(db);
    let intercepted = false;
    const spy = vi.spyOn(db, "withTransaction").mockImplementation(async <T>(callback: (session: ClientSession) => Promise<T>): Promise<T> => {
      const result = await transact(callback);
      if (!intercepted) {
        // The marking transaction has committed; restore before purge opens its removal transaction.
        intercepted = true;
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true }))
          .toMatchObject({ deleted: expect.any(Date), deleted_by: alreadyMarked ? "original@d" : adminUser.email, attached_to_name: first });
        expect(await db.findOne("PurgeBook", first, "app", undefined, { includeDeleted: true }))
          .toMatchObject({ deleted: expect.any(Date) });
        await documentService.restoreDoc(DIGITA.COLLECTIONS.FILE, fileId, adminUser);
        const restored = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
        expect(restored).toMatchObject({ attached_to_name: first, storage_key: key, thumbnail_key: thumbKey });
        expect(restored?.["deleted"] ?? null).toBeNull();
        expect(restored?.["deleted_by"] ?? null).toBeNull();
      }
      return result;
    });
    try {
      expect(await documentService.purgeDoc("PurgeBook", first, adminUser, { deletedBefore: monthsAgo(12) }))
        .toMatchObject({ purged: true, files_deleted: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(intercepted).toBe(true);
    expect(await db.findOne("PurgeBook", first, "app", undefined, { includeDeleted: true })).toBeNull();
    const retained = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(retained).toMatchObject({ attached_to_entity: "PurgeBook", attached_to_name: null, storage_key: key, thumbnail_key: thumbKey });
    expect(retained?.["deleted"] ?? null).toBeNull();
    expect(retained?.["deleted_by"] ?? null).toBeNull();
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.exists(thumbKey)).toBe(true);
    await createAndReadReusedParent(first, newToken);
    await expectDownloads(fileUrl, newToken);
    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
  });

  it.each([
    [true, "507F1F77BCF86CD799439011"], [false, "507F1F77BCF86CD799439012"],
    [true, "507f1F77bCf86cD799439013"], [false, "507f1F77bCf86cD799439014"],
  ] as const)("invalidates canonical parent bindings (included in attachment: %s, spelling: %s)", async (includedInAttachment, mixedCaseParent) => {
    const canonicalParent = mixedCaseParent.toLowerCase();
    const suffix = canonicalParent.slice(-3);
    const last = `B-OTHER-REF-${suffix}`;
    const fileId = `FILE-MIXED-CASE-${suffix}`;
    const key = `books/mixed-${suffix}.png`;
    const thumbKey = `books/mixed-${suffix}-thumb.png`;
    const fileUrl = `/api/v1/file/${fileId}/download`;
    const bytes: [Buffer, Buffer] = [Buffer.from("mixed case parent bytes"), Buffer.from("mixed thumb bytes")];
    const [originalToken, adminToken, newToken] = await Promise.all([
      sign({ sub: "original@d", email: "original@d", roles: ["System User"] }),
      sign({ sub: adminUser._id, email: adminUser.email, roles: adminUser.roles }),
      sign({ sub: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] }),
    ]);

    await storage.put(key, bytes[0], "image/png");
    await storage.put(thumbKey, bytes[1], "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, file_name: "mixed.png", file_type: "image/png", storage_key: key,
      thumbnail_key: thumbKey, thumbnail_url: `${fileUrl}?thumb=1`,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: mixedCaseParent,
      owner: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: toIdStorage(canonicalParent), title: "Parent A", owner: "original@d",
      deleted_by: "original@d", deleted: monthsAgo(14),
      creation: monthsAgo(16), modified: monthsAgo(14),
      ...(includedInAttachment ? { attachment: fileUrl } : {}),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: last, title: "Parent B", owner: "other@d",
      creation: monthsAgo(16), modified: monthsAgo(14),
      attachment: fileUrl,
    }, "app");

    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    await expectDownloads(fileUrl, newToken);

    const cutoff = { deletedBefore: monthsAgo(12) };
    expect(await documentService.purgeDoc("PurgeBook", canonicalParent, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 0 });

    const retained = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(retained).toMatchObject({ attached_to_entity: "PurgeBook", attached_to_name: null, storage_key: key, thumbnail_key: thumbKey });
    expect(retained?.["deleted"] ?? null).toBeNull();
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.exists(thumbKey)).toBe(true);

    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);
    await createAndReadReusedParent(canonicalParent, newToken);
    await expectDownloads(fileUrl, newToken);

    const deps = (documentService as unknown as { fileAccess(): FileAccessDeps }).fileAccess();
    const newOwner = { _id: "new@d", email: "new@d", roles: ["System User", "Bound Reader"] };
    expect(await deps.permissionChecker.hasPermission(newOwner, "PurgeBook", "read", { _id: canonicalParent, owner: "new@d" })).toMatchObject({ allowed: true });
    expect(await mayReadFile(deps, newOwner, retained!)).toBe(false);
  });

  it("purges shared File when two parent purges are interleaved between phase 1 and phase 2", async () => {
    const parentA = "B-INTERLEAVED-A";
    const parentB = "B-INTERLEAVED-B";
    const fileId = "FILE-INTERLEAVED-AB";
    const key = "books/interleaved-ab.png";
    const thumbKey = "books/interleaved-ab-thumb.png";
    const fileUrl = `/api/v1/file/${fileId}/download`;
    const bytes: [Buffer, Buffer] = [Buffer.from("interleaved bytes"), Buffer.from("interleaved thumb")];
    const [originalToken, adminToken] = await Promise.all([
      sign({ sub: "original@d", email: "original@d", roles: ["System User"] }),
      sign({ sub: adminUser._id, email: adminUser.email, roles: adminUser.roles }),
    ]);

    await storage.put(key, bytes[0], "image/png");
    await storage.put(thumbKey, bytes[1], "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, doctype: "File", docstatus: 0, file_name: "interleaved.png", file_type: "image/png",
      storage_key: key, thumbnail_key: thumbKey, thumbnail_url: `${fileUrl}?thumb=1`,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: parentA,
      owner: "original@d", modified_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: parentA, title: "Due A", owner: "original@d", attachment: fileUrl,
      deleted: monthsAgo(14), deleted_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: parentB, title: "Due B", owner: "original@d", attachment: fileUrl,
      deleted: monthsAgo(14), deleted_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(14),
    }, "app");

    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);

    const cutoff = { deletedBefore: monthsAgo(12) };
    const transact = db.withTransaction.bind(db);
    let intercepted = false;
    const spy = vi.spyOn(db, "withTransaction").mockImplementation(async <T>(callback: (session: ClientSession) => Promise<T>): Promise<T> => {
      const result = await transact(callback);
      if (!intercepted) {
        // Phase 1 of A committed (skipped F because B referenced F). Interleave B's full purge here.
        intercepted = true;
        const bResult = await documentService.purgeDoc("PurgeBook", parentB, adminUser, cutoff);
        expect(bResult).toMatchObject({ purged: true, files_deleted: 0 });
        expect(await db.findOne("PurgeBook", parentB, "app", undefined, { includeDeleted: true })).toBeNull();
      }
      return result;
    });

    try {
      const aResult = await documentService.purgeDoc("PurgeBook", parentA, adminUser, cutoff);
      expect(aResult).toMatchObject({ purged: true, files_deleted: 1 });
    } finally {
      spy.mockRestore();
    }

    expect(intercepted).toBe(true);
    expect(await db.findOne("PurgeBook", parentA, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne("PurgeBook", parentB, "app", undefined, { includeDeleted: true })).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.exists(thumbKey)).toBe(false);
  });

  it("soft-deletes an unbound File when Administrator removes its last reference after parent purge", async () => {
    const parentA = "B-FINAL-REF-A";
    const parentB = "B-FINAL-REF-B";
    const fileId = "FILE-FINAL-REF-AB";
    const key = "books/final-ref-ab.png";
    const thumbKey = "books/final-ref-ab-thumb.png";
    const fileUrl = `/api/v1/file/${fileId}/download`;
    const bytes: [Buffer, Buffer] = [Buffer.from("final ref bytes"), Buffer.from("final ref thumb")];
    const [originalToken, adminToken] = await Promise.all([
      sign({ sub: "original@d", email: "original@d", roles: ["System User"] }),
      sign({ sub: adminUser._id, email: adminUser.email, roles: adminUser.roles }),
    ]);

    await storage.put(key, bytes[0], "image/png");
    await storage.put(thumbKey, bytes[1], "image/png");

    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId, doctype: "File", docstatus: 0, file_name: "final-ref.png", file_type: "image/png",
      storage_key: key, thumbnail_key: thumbKey, thumbnail_url: `${fileUrl}?thumb=1`,
      file_url: fileUrl, is_private: true, attached_to_entity: "PurgeBook", attached_to_name: parentA,
      owner: "original@d", modified_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(16),
    }, DIGITA.DATABASES.CORE);

    await db.insertOne("PurgeBook", {
      _id: parentA, title: "Due A", owner: "original@d", attachment: fileUrl,
      deleted: monthsAgo(14), deleted_by: "original@d", creation: monthsAgo(16), modified: monthsAgo(14),
    }, "app");

    await db.insertOne("PurgeBook", {
      _id: parentB, title: "Live B", owner: "other@d", attachment: fileUrl,
      creation: monthsAgo(16), modified: monthsAgo(14),
    }, "app");

    for (const token of [originalToken, adminToken]) await expectDownloads(fileUrl, token, bytes);

    const cutoff = { deletedBefore: monthsAgo(12) };
    // Purge A: F is detached (attached_to_name becomes null) but preserved active because B still references it
    expect(await documentService.purgeDoc("PurgeBook", parentA, adminUser, cutoff)).toMatchObject({ purged: true, files_deleted: 0 });
    const detachedFile = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(detachedFile).toMatchObject({ attached_to_entity: "PurgeBook", attached_to_name: null });
    expect(detachedFile?.["deleted"] ?? null).toBeNull();
    expect(await storage.exists(key)).toBe(true);

    // Now Administrator (not original uploader) removes the final attachment from B
    await documentService.update("PurgeBook", parentB, { attachment: null }, adminUser);
    expect(await db.findOne("PurgeBook", parentB, "app")).toMatchObject({ title: "Live B", attachment: null });

    // cleanupDocumentAttachments uses File.delete permission to soft-delete the unbound file; bytes are kept
    const markedFile = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(markedFile?.["deleted"]).toBeInstanceOf(Date);
    expect(markedFile?.["deleted_by"]).toBe(adminUser.email);
    expect(markedFile?.["storage_key"]).toBe(key);
    expect(markedFile?.["thumbnail_key"]).toBe(thumbKey);
    expect(await storage.exists(key)).toBe(true);
    expect(await storage.exists(thumbKey)).toBe(true);

    // Later physical purge of the marked File deletes bytes and cleans up metadata
    const fileCutoff = { deletedBefore: new Date((markedFile!["deleted"] as Date).getTime() + 1000) };
    const purgeFileResult = await documentService.purgeDoc(DIGITA.COLLECTIONS.FILE, fileId, adminUser, fileCutoff);
    expect(purgeFileResult).toMatchObject({ purged: true, files_deleted: 1 });
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true })).toBeNull();
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.exists(thumbKey)).toBe(false);
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

    // Other retained fixtures remain in this app; the purge correctly includes their due rows too.
    const existingDueBooks = await db.count("PurgeBook", [
      { deleted: { $type: "date", $lt: monthsAgo(12) } },
    ], "app", undefined, { includeDeleted: true });

    // Insert 105 deleted records for chunking verification
    const bulkDocs = [];
    for (let i = 1; i <= 105; i++) {
      bulkDocs.push({
        _id: `000-CHUNK-BOOK-${String(i).padStart(3, "0")}`,
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
    expect(parsedCursor.after).toBe("000-CHUNK-BOOK-100");
    expect(parsedCursor.records).toBe(100);

    // Chunk 2: resuming with cursor to complete PurgeBook
    const res2 = await documentService.runAction(
      "Setting", "Setting", "purge_deleted", adminUser, undefined,
      { [JOBS_CURSOR_PARAM]: res1.cursor },
    ) as { done: boolean; cursor?: string; progress: { completed: number } };

    const parsedCursor2 = res2.cursor ? JSON.parse(res2.cursor) as { entity: string; records: number; files: number; after?: string } : null;
    if (!res2.done && parsedCursor2) {
      expect(parsedCursor2.records).toBe(105 + existingDueBooks + parsedCursor2.files);
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

    const remaining = await db.count("PurgeBook", [{ _id: { $regex: "^000-CHUNK-BOOK-" } }], "app", undefined, { includeDeleted: true });
    expect(remaining).toBe(0);
  });
});

describe("retention purge authority", () => {
  // Unique collections isolate counts from intentionally retained prior fixtures.
  async function personalRows(owner = `other-${randomUUID()}@d`) {
    const entity = {
      ...PURGE_BOOK, name: `RetainedPersonal${randomUUID().replaceAll("-", "")}`, personal: true,
      permissions: [
        ...PURGE_BOOK.permissions,
        { role: "System User", level: 0, read: 1, write: 1, delete: 1 },
      ],
    } satisfies EntityDefinition;
    registry.register(entity);
    await db.ensureCollection(entity.name, "app");
    await new IndexManager(db).ensureIndexes(entity);
    const secret = `private-${randomUUID()}`;
    const ids = { due: randomUUID(), live: randomUUID(), young: randomUUID() };
    for (const [kind, id] of Object.entries(ids)) {
      await db.insertOne(entity.name, {
        _id: id, doctype: entity.name, title: `${secret}-${kind}`, owner,
        modified_by: owner, creation: monthsAgo(14), modified: monthsAgo(14),
        ...(kind === "live" ? {} : {
          deleted: monthsAgo(kind === "due" ? 14 : 2), deleted_by: owner,
        }),
      }, "app");
    }
    const rows = await db.findManyByFilter(entity.name, {}, "app", undefined, { includeDeleted: true });
    const cursor = JSON.stringify({
      entity: entity.name, completed: 0, records: 0, files: 0, versions: 0, translations: 0,
    });
    return { entity: entity.name, ids, secret, rows, cursor };
  }

  it.each([false, true])("keeps ordinary owner gates and reference guards; shared attachment=%s", async (shared) => {
    await db.updateOne("Setting", "Setting", { deleted_retention_months: "12" }, DIGITA.DATABASES.CORE);
    const f = await personalRows();
    await expect(documentService.getDoc(f.entity, f.ids.live, adminUser))
      .rejects.toMatchObject({ status: 403 });
    await expect(documentService.deleteDoc(f.entity, f.ids.live, adminUser))
      .rejects.toMatchObject({ status: 403 });
    await expect(documentService.restoreDoc(f.entity, f.ids.due, adminUser))
      .rejects.toMatchObject({ status: 403 });
    await expect(documentService.purgeDoc(f.entity, f.ids.due, adminUser, { deletedBefore: monthsAgo(12) }))
      .rejects.toMatchObject({ status: 403 });

    const fileId = randomUUID();
    const key = `q9/${randomUUID()}.txt`;
    await storage.put(key, Buffer.from(f.secret), "text/plain");
    await db.insertOne("File", {
      _id: fileId, doctype: "File", file_name: "private.txt", storage_key: key,
      file_type: "text/plain", file_url: `/api/v1/file/${fileId}/download`,
      owner: `unbound-${randomUUID()}@d`, modified_by: adminUser.email,
      creation: monthsAgo(14), modified: monthsAgo(14), deleted: monthsAgo(14),
    }, DIGITA.DATABASES.CORE);
    await db.updateOne(f.entity, f.ids.due, { attachment: `/api/v1/file/${fileId}/download` }, "app");
    if (shared) {
      await db.updateOne(f.entity, f.ids.young, { attachment: `/api/v1/file/${fileId}/download` }, "app");
      f.rows = await db.findManyByFilter(f.entity, {}, "app", undefined, { includeDeleted: true });
    }

    const run = await documentService.runAction("Setting", "Setting", "purge_deleted", adminUser,
      undefined, { [JOBS_CURSOR_PARAM]: f.cursor }) as {
        done: boolean; cursor: string; progress: { completed: number };
      };
    expect(run.done).toBe(false); // File is always later than this custom entity.
    expect(run.progress.completed).toBe(1);
    expect(JSON.parse(run.cursor)).toMatchObject({
      completed: 1, records: shared ? 1 : 2, files: shared ? 0 : 1, versions: 0, translations: 0,
    });
    expect(Object.keys(run).sort()).toEqual(["cursor", "done", "progress"]);
    const output = JSON.stringify(run);
    expect(output).not.toContain(f.secret);
    expect(output).not.toContain(f.rows[0]!["owner"]);
    expect(output).not.toMatch(/"(?:title|owner|doctype|attachment|_id)"\s*:/);
    expect(await db.findOne(f.entity, f.ids.due, "app", undefined, { includeDeleted: true })).toBeNull();
    for (const id of [f.ids.live, f.ids.young]) {
      expect(await db.findOne(f.entity, id, "app", undefined, { includeDeleted: true }))
        .toEqual(f.rows.find(row => String(row["_id"]) === id));
    }
    const file = await db.findOne("File", fileId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    if (shared) expect(file).toMatchObject({ storage_key: key, deleted: expect.any(Date) });
    else expect(file).toBeNull();
    expect(await storage.exists(key)).toBe(shared);
  });

  it.each(["missing Administrator", "denied Setting.write"] as const)(
    "rejects %s despite weakened metadata, including direct internal calls", async (gate) => {
      await db.updateOne("Setting", "Setting", { deleted_retention_months: "12" }, DIGITA.DATABASES.CORE);
      const actor = gate === "missing Administrator"
        ? { ...adminUser, roles: ["System User"] } : adminUser;
      const f = await personalRows(actor.email); // Ordinary row deletion is allowed for this actor.
      const setting = registry.get("Setting");
      registry.register({
        ...setting, actions: setting.actions!.map(action => action.action === "purge_deleted"
          ? { ...action, allowed_roles: [], requires_permission: undefined, show_if: undefined }
          : action),
      });
      const original = PermissionChecker.prototype.hasPermission;
      const permission = vi.spyOn(PermissionChecker.prototype, "hasPermission")
        .mockImplementation(function (this: PermissionChecker, user, entity, action, doc) {
          if (entity === "Setting") {
            return Promise.resolve({
              allowed: !(gate === "denied Setting.write" && action === "write"),
              reason: "Retention permission fixture",
            });
          }
          return original.call(this, user, entity, action, doc);
        });
      try {
        await expect(documentService.runAction("Setting", "Setting", "purge_deleted", actor,
          undefined, { [JOBS_CURSOR_PARAM]: f.cursor })).rejects.toMatchObject({ status: 403 });
        expect(await db.findManyByFilter(f.entity, {}, "app", undefined, { includeDeleted: true }))
          .toEqual(f.rows);
        permission.mockClear();
        await expect(documentService.purgeDoc(f.entity, f.ids.due, actor,
          { deletedBefore: monthsAgo(12) }, undefined, true)).rejects.toMatchObject({ status: 403 });
        if (gate === "denied Setting.write") {
          expect(permission).toHaveBeenCalledWith(actor, "Setting", "write", expect.anything());
        }
        expect(await db.findManyByFilter(f.entity, {}, "app", undefined, { includeDeleted: true }))
          .toEqual(f.rows);
      } finally {
        permission.mockRestore();
        registry.register(setting);
      }
    },
  );

  it("rejects a fresh cutoff before mutation and still enforces expiry internally", async () => {
    await db.updateOne("Setting", "Setting", { deleted_retention_months: "12" }, DIGITA.DATABASES.CORE);
    const f = await personalRows(adminUser.email);
    await expect(documentService.purgeDoc(f.entity, f.ids.due, adminUser,
      { deletedBefore: new Date() }, undefined, true)).rejects.toThrow();
    expect(await db.findManyByFilter(f.entity, {}, "app", undefined, { includeDeleted: true }))
      .toEqual(f.rows);
    await expect(documentService.purgeDoc(f.entity, f.ids.young, adminUser,
      { deletedBefore: monthsAgo(12) }, undefined, true)).resolves.toMatchObject({ purged: false });
    expect(await db.findManyByFilter(f.entity, {}, "app", undefined, { includeDeleted: true }))
      .toEqual(f.rows);
  });
});
