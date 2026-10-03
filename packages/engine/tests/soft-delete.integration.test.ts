import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

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


// A person deletes a record by mistake: the record leaves every read of its entity, waits in the
// same collection, and a person who may delete it brings it back through its insert hooks.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import { IndexManager } from "../src/core/database/index-manager.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let documentService: DocumentService;
let adminTok: string;
let clerkTok: string;
let readerTok: string;
let shelverTok: string;
let shareKeeperTok: string;
let deleteOnlyTok: string;
const insertHooks: string[] = [];
const postUpdateHooks: string[] = [];
const beforeSaveHooks: string[] = [];
let rebuildCopies = false;

const SHELF: EntityDefinition = {
  name: "SdShelf",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "label", fieldtype: "Data", label: "Label" }],
  permissions: [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }],
} as unknown as EntityDefinition;

const BOOK: EntityDefinition = {
  name: "SdBook",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", translatable: true },
    { fieldname: "code", fieldtype: "Data", label: "Code", unique: true },
    { fieldname: "shelf", fieldtype: "Link", label: "Shelf", target: "SdShelf" },
    { fieldname: "pin", fieldtype: "Password", label: "Pin" },
    {
      fieldname: "copies",
      fieldtype: "Table",
      label: "Copies",
      child_fields: [{ fieldname: "barcode", fieldtype: "Data", label: "Barcode" }],
    },
    { fieldname: "attachment", fieldtype: "Attach", label: "Attachment" },
    { fieldname: "secret_note", fieldtype: "Data", label: "Secret Note", perm_level: 1 },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Administrator", level: 1, read: 1, write: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Reader", level: 0, select: 1, read: 1 },
    { role: "ShareKeeper", level: 0, select: 1 },
    { role: "ShareKeeper", level: 0, read: 1, if_owner: true },
    { role: "ShareKeeper", level: 0, delete: 1, condition: "doc.code == 'C-SHARE-KEEP'" },
    { role: "Shelver", level: 0, select: 1, read: 1, delete: 1, condition: "doc.code == 'C-9' || doc.code == 'C-COUNT-YES'" },
    { role: "DeleteOnly", level: 0, delete: 1 },
  ],
} as unknown as EntityDefinition;

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const createBook = (payload: Record<string, unknown>, token = adminTok) =>
  app.inject({ method: "POST", url: "/api/v1/resource/SdBook", headers: as(token), payload });
const deleteBook = (name: string, token = adminTok) =>
  app.inject({ method: "DELETE", url: `/api/v1/resource/SdBook/${name}`, headers: as(token) });
const listDeleted = (token = adminTok) =>
  app.inject({ method: "GET", url: `/api/v1/resource/SdBook?filters=${encodeURIComponent(JSON.stringify([["deleted", "is", "set"]]))}&order_by=deleted%20desc`, headers: as(token) });
const restoreBook = (name: string, token = adminTok) =>
  app.inject({ method: "POST", url: `/api/v1/resource/SdBook/${name}/restore`, headers: as(token), payload: {} });
const deletedNames = async () => ((await listDeleted()).json().data as Array<{ _id: string }>).map((row) => row._id);
const titleTranslation = (name: string) => ({
  _id: `data:de:SdBook.${name}.title`,
  namespace: "data", locale: "de", key: `SdBook.${name}.title`, value: `Titel ${name}`,
  entity: "SdBook", document_name: name, fieldname: "title", source: "user",
  overridden: false, creation: new Date(), modified: new Date(),
});

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  const registry = result.registry as unknown as { register: (e: EntityDefinition) => void };
  registry.register(SHELF);
  registry.register(BOOK);
  for (const entity of [SHELF, BOOK]) {
    await db.ensureCollection(entity.name, "app");
    await new IndexManager(db).ensureIndexes(entity);
  }
  documentService = result.hookRunner.getServices()?.documentService as DocumentService;
  // The book's hooks, as an app module would declare them.
  await db.ensureCollection("SdBookHookMarker", "app");
  type TestHook = (doc: { _id: string; _data: Record<string, unknown> }, ctx?: unknown, services?: { session?: import("mongodb").ClientSession }) => Promise<void> | void;
  const hooks = (result.hookRunner as unknown as { hooks: Map<string, Map<string, TestHook>> }).hooks;
  hooks.set("SdBook", new Map<string, TestHook>([
    ["before_insert", (doc) => {
      insertHooks.push(`before_insert ${doc._id}`);
      if (rebuildCopies) doc._data["copies"] = [{ barcode: "Rebuilt" }];
    }],
    ["after_insert", (doc) => void insertHooks.push(`after_insert ${doc._id}`)],
    ["before_save", async (doc, _ctx, services) => {
      if (doc._id !== "B-UPDATE-MARKED") return;
      beforeSaveHooks.push(doc._id);
      await db.updateOne("SdBook", doc._id, { deleted: new Date(), deleted_by: "admin@d" }, "app", services?.session);
      await db.insertOne("SdBookHookMarker", { _id: `marker-update-${doc._id}`, action: "before_save" }, "app", services?.session);
    }],
    ["on_update", (doc) => void postUpdateHooks.push(`on_update ${doc._id}`)],
  ]));
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk"] });
  readerTok = await ta.sign({ sub: "reader@d", email: "reader@d", roles: ["Reader"] });
  shelverTok = await ta.sign({ sub: "shelver@d", email: "shelver@d", roles: ["Shelver"] });
  shareKeeperTok = await ta.sign({ sub: "keeper-id", email: "keeper@d", roles: ["ShareKeeper"] });
  deleteOnlyTok = await ta.sign({ sub: "delonly@d", email: "delonly@d", roles: ["DeleteOnly"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a deleted record", () => {
  it("PLANTED DEFECT: leaves ordinary reads and keeps its own row, values and texts", async () => {
    expect((await createBook({ _id: "B1", title: "Gone", code: "C-1", copies: [{ barcode: "X1" }] })).statusCode).toBe(201);
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, titleTranslation("B1"), DIGITA.DATABASES.CORE);
    expect((await deleteBook("B1")).statusCode).toBe(200);

    const read = (url: string) => app.inject({ method: "GET", url, headers: as(adminTok) });
    expect((await read("/api/v1/resource/SdBook/B1")).statusCode).toBe(404);
    expect((await read("/api/v1/resource/SdBook")).json().data.map((r: { _id: string }) => r._id)).not.toContain("B1");
    expect((await read("/api/v1/resource/SdBook/count")).json().data.count).toBe(0);
    expect(await db.findOne("SdBook", "B1", "app")).toBeNull();

    const kept = await db.findOne("SdBook", "B1", "app", undefined, { includeDeleted: true });
    expect(kept).toMatchObject({ _id: "B1", deleted_by: "admin@d", title: "Gone", code: "C-1" });
    expect(kept?.["deleted"]).toBeInstanceOf(Date);
    const texts = await db.findManyByFilter(DIGITA.COLLECTIONS.TRANSLATION, { entity: "SdBook", document_name: "B1" }, DIGITA.DATABASES.CORE);
    expect(texts).toHaveLength(1);
  });

  it("PLANTED DEFECT: comes back with its id, child rows and texts, through its insert hooks, and the log names both", async () => {
    expect((await createBook({ _id: "B2", title: "Back", code: "C-2", pin: "1234", copies: [{ barcode: "Y1" }] })).statusCode).toBe(201);
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, titleTranslation("B2"), DIGITA.DATABASES.CORE);
    const before = (await db.findOne("SdBook", "B2", "app"))!;
    expect((await deleteBook("B2")).statusCode).toBe(200);
    insertHooks.length = 0;

    const restored = await restoreBook("B2");
    expect(restored.statusCode).toBe(200);
    expect(insertHooks).toEqual(["before_insert B2", "after_insert B2"]);
    const after = (await db.findOne("SdBook", "B2", "app"))!;
    expect(after).toMatchObject({ title: "Back", code: "C-2", pin: before["pin"], owner: before["owner"], creation: before["creation"] });
    expect(before["pin"]).not.toBe("1234");
    expect(after["copies"]).toEqual(before["copies"]);
    expect(await deletedNames()).not.toContain("B2");
    expect(after["deleted"]).toBeUndefined();
    expect(after["deleted_by"]).toBeUndefined();
    expect(after["modified_by"]).toBe("admin@d");
    expect((after["modified"] as Date).getTime()).toBeGreaterThan((before["modified"] as Date).getTime());

    const german = await app.inject({ method: "GET", url: "/api/v1/resource/SdBook/B2", headers: { ...as(adminTok), "accept-language": "de" } });
    expect(german.json().data.title).toBe("Titel B2");
    const log = await db.findManyByFilter(DIGITA.COLLECTIONS.LOG, { entity: "SdBook", document_name: "B2" }, DIGITA.DATABASES.LOGS);
    expect(log.map((row) => row["action"])).toEqual(expect.arrayContaining(["Deleted", "Restored"]));
  });

  it("PLANTED DEFECT: supplies stable row IDs when an insert hook rebuilds restored child rows", async () => {
    expect((await createBook({ _id: "B11", title: "Copies", code: "C-11" })).statusCode).toBe(201);
    expect((await deleteBook("B11")).statusCode).toBe(200);
    rebuildCopies = true;
    try {
      expect((await restoreBook("B11")).statusCode).toBe(200);
    } finally { rebuildCopies = false; }
    const row = (await db.findOne("SdBook", "B11", "app"))!;
    expect(row["copies"]).toEqual([{ barcode: "Rebuilt", _row_id: expect.any(String) }]);
  });

  it("PLANTED DEFECT: keeps a save that commits before the deletion transaction begins", async () => {
    expect((await createBook({ _id: "B12", title: "Before", code: "C-12" })).statusCode).toBe(201);
    const transaction = db.withTransaction.bind(db);
    vi.spyOn(db, "withTransaction").mockImplementationOnce(async (work) => {
      await db.updateOne("SdBook", "B12", { title: "Saved while deletion waited" }, "app");
      return transaction(work);
    });
    expect((await deleteBook("B12")).statusCode).toBe(200);
    expect((await restoreBook("B12")).statusCode).toBe(200);
    expect((await db.findOne("SdBook", "B12", "app"))?.["title"]).toBe("Saved while deletion waited");
  });

  it("PLANTED DEFECT: accepts only engine-written deletion markers", async () => {
    expect((await createBook({ _id: "B13", title: "Live", code: "C-13", deleted: "2026-01-01", deleted_by: "forged" })).statusCode).toBe(201);
    expect(await db.findOne("SdBook", "B13", "app")).toMatchObject({ title: "Live" });
    expect((await db.findOne("SdBook", "B13", "app"))?.["deleted"]).toBeUndefined();
  });

  it("PLANTED DEFECT: keeps its id and unique values reserved while deleted", async () => {
    expect((await createBook({ _id: "B3", title: "First", code: "C-3" })).statusCode).toBe(201);
    expect((await deleteBook("B3")).statusCode).toBe(200);
    expect((await createBook({ _id: "B3", title: "Second", code: "C-3b" })).statusCode).toBe(409);
    expect((await createBook({ _id: "B3b", title: "Took the code", code: "C-3" })).statusCode).toBe(409);
    expect((await restoreBook("B3")).statusCode).toBe(200);
    expect((await db.findOne("SdBook", "B3", "app"))?.["title"]).toBe("First");
  });

  it("is refused a restore whose link names a record that is gone", async () => {
    await db.insertOne("SdShelf", { _id: "S1", label: "Window", doctype: "SdShelf", docstatus: 0, owner: "admin@d", modified_by: "admin@d", creation: new Date(), modified: new Date() }, "app");
    expect((await createBook({ _id: "B6", title: "On a shelf", code: "C-6", shelf: "S1" })).statusCode).toBe(201);
    expect((await deleteBook("B6")).statusCode).toBe(200);
    // The deleted book no longer links the shelf, so the delete protection lets the shelf go.
    expect((await app.inject({ method: "DELETE", url: "/api/v1/resource/SdShelf/S1", headers: as(adminTok) })).statusCode).toBe(200);
    const restored = await restoreBook("B6");
    expect([restored.statusCode, restored.json().messages[0].path]).toEqual([400, "shelf"]);
  });

  it("is listed and restored only for a person who may delete records of its entity", async () => {
    expect((await createBook({ _id: "B7", title: "Clerk's", code: "C-7" }, clerkTok)).statusCode).toBe(201);
    expect((await deleteBook("B7", clerkTok)).statusCode).toBe(200);

    expect((await listDeleted(readerTok)).statusCode).toBe(403);
    expect((await restoreBook("B7", readerTok)).statusCode).toBe(403);

    const listed = (await listDeleted(clerkTok)).json().data as Array<Record<string, unknown>>;
    expect(listed[0]).toMatchObject({ _id: "B7", title: "Clerk's", deleted_by: "clerk@d" });
    expect((await restoreBook("B7", clerkTok)).statusCode).toBe(200);
  });

  it("PLANTED DEFECT: is listed and restored only where the person's delete row admits it", async () => {
    for (const [name, code] of [["B9", "C-9"], ["B10", "C-10"]]) {
      expect((await createBook({ _id: name, title: name, code })).statusCode).toBe(201);
      expect((await deleteBook(name!)).statusCode).toBe(200);
    }
    const listed = (await listDeleted(shelverTok)).json().data as Array<Record<string, unknown>>;
    expect(listed.map((row) => row["_id"])).toEqual(["B9"]);
    expect((await restoreBook("B10", shelverTok)).statusCode).toBe(403);
    expect((await restoreBook("B9", shelverTok)).statusCode).toBe(200);
  });

  it("PLANTED DEFECT / INNOCENT: keeps a live record named deleted addressable", async () => {
    expect((await createBook({ _id: "deleted", title: "An ordinary name", code: "C-deleted" })).statusCode).toBe(201);
    const read = await app.inject({ method: "GET", url: "/api/v1/resource/SdBook/deleted", headers: as(adminTok) });
    expect([read.statusCode, read.json().data._id]).toEqual([200, "deleted"]);
  });

  it("refuses duplicate deletion and restoration without another insert-hook run", async () => {
    expect((await createBook({ _id: "B8", title: "Once", code: "C-8" })).statusCode).toBe(201);
    expect((await deleteBook("B8")).statusCode).toBe(200);
    expect((await deleteBook("B8")).statusCode).toBe(404);
    expect((await restoreBook("B8")).statusCode).toBe(200);
    insertHooks.length = 0;
    expect((await restoreBook("B8")).statusCode).toBe(404);
    expect(insertHooks).toEqual([]);
    expect((await restoreBook("absent")).statusCode).toBe(404);
  });

  it("counts deleted rows only with delete permission and the ordinary row read gate", async () => {
    for (const [name, code] of [["B-COUNT-YES", "C-COUNT-YES"], ["B-COUNT-NO", "C-COUNT-NO"]]) {
      expect((await createBook({ _id: name, title: name, code })).statusCode).toBe(201);
      expect((await deleteBook(name!)).statusCode).toBe(200);
    }
    const ids = { _id: { $in: ["B-COUNT-YES", "B-COUNT-NO"] } };
    const count = (token: string, filters: Record<string, unknown>[]) => app.inject({
      method: "GET", url: `/api/v1/resource/SdBook/count?filters=${encodeURIComponent(JSON.stringify(filters))}`, headers: as(token),
    });
    expect((await count(adminTok, [ids])).json().data.count).toBe(0);
    expect((await count(adminTok, [ids, { deleted: { $ne: null } }])).json().data.count).toBe(2);
    expect((await count(shelverTok, [ids, { deleted: { $ne: null } }])).json().data.count).toBe(1);
    expect((await count(readerTok, [ids, { deleted: { $ne: null } }])).statusCode).toBe(403);
  });

  it("keeps deleted share-only rows in the shared query path and still checks each delete grant", async () => {
    for (const [name, code] of [["B-SHARED-DELETED-YES", "C-SHARE-KEEP"], ["B-SHARED-DELETED-NO", "C-SHARE-DENY"]]) {
      expect((await createBook({ _id: name, title: name, code })).statusCode).toBe(201);
      await db.insertOne(DIGITA.COLLECTIONS.DOC_SHARE, {
        _id: `SdBook:${name}:keeper@d`, entity: "SdBook", document_name: name,
        shared_with: "keeper@d", can_read: true, owner: "admin@d", creation: new Date(), modified: new Date(),
      }, DIGITA.DATABASES.IDENTITY);
      expect((await deleteBook(name!)).statusCode).toBe(200);
    }
    const response = await listDeleted(shareKeeperTok);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((row: { _id: string }) => row._id)).toEqual(["B-SHARED-DELETED-YES"]);
    expect(response.json().meta.total).toBe(1);
  });

  it("refuses generic DELETE resource/File/id, POST bulk-delete, and DELETE file/id for a File held by a deleted parent", async () => {
    const fileId = "FILE-HELD-BY-DEL-PARENT";
    const fileUrl = `/api/v1/file/${fileId}/download`;
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: fileId,
      doctype: "File",
      docstatus: 0,
      file_name: "parent-attachment.pdf",
      file_url: fileUrl,
      is_private: true,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: new Date(),
      modified: new Date(),
    }, DIGITA.DATABASES.CORE);

    expect((await createBook({ _id: "B-PARENT", title: "Parent Book", code: "C-PARENT", attachment: fileUrl })).statusCode).toBe(201);
    expect((await deleteBook("B-PARENT")).statusCode).toBe(200);
    expect((await db.findOne("SdBook", "B-PARENT", "app", undefined, { includeDeleted: true }))?.["deleted"]).toBeInstanceOf(Date);

    // generic DELETE resource/File/id refuses
    const resGeneric = await app.inject({ method: "DELETE", url: `/api/v1/resource/File/${fileId}`, headers: as(adminTok) });
    expect(resGeneric.statusCode).toBe(409);
    expect(resGeneric.json().error.code).toBe("DELETE_BLOCKED");
    let fileDoc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE);
    expect(fileDoc?.["deleted"]).toBeUndefined();

    // POST resource/File/bulk-delete { names } refuses
    const resBulk = await app.inject({
      method: "POST",
      url: "/api/v1/resource/File/bulk-delete",
      headers: as(adminTok),
      payload: { names: [fileId] },
    });
    expect(resBulk.statusCode).toBe(200);
    expect(resBulk.json().data.deleted).toEqual([]);
    expect(resBulk.json().data.failed).toHaveLength(1);
    expect(resBulk.json().data.failed[0]).toMatchObject({ name: fileId });
    fileDoc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE);
    expect(fileDoc?.["deleted"]).toBeUndefined();

    // DELETE file/id refuses
    const resDirect = await app.inject({ method: "DELETE", url: `/api/v1/file/${fileId}`, headers: as(adminTok) });
    expect(resDirect.statusCode).toBe(409);
    expect(resDirect.json().error.code).toBe("DELETE_BLOCKED");
    fileDoc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE);
    expect(fileDoc?.["deleted"]).toBeUndefined();

    // Unreferenced File positive still marks
    const unreferencedId = "FILE-FREE-UNREFERENCED";
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: unreferencedId,
      doctype: "File",
      docstatus: 0,
      file_name: "free.pdf",
      file_url: `/api/v1/file/${unreferencedId}/download`,
      is_private: true,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: new Date(),
      modified: new Date(),
    }, DIGITA.DATABASES.CORE);

    const resFree = await app.inject({ method: "DELETE", url: `/api/v1/file/${unreferencedId}`, headers: as(adminTok) });
    expect(resFree.statusCode).toBe(200);
    const markedFree = await db.findOne(DIGITA.COLLECTIONS.FILE, unreferencedId, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(markedFree?.["deleted"]).toBeInstanceOf(Date);
    expect(markedFree?.["deleted_by"]).toBe("admin@d");
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, unreferencedId, DIGITA.DATABASES.CORE)).toBeNull();
  });

  it("prevents zero-reference gap when shared attachment owner drops reference, across mark and restore, and supports uppercase system-ID URL aliases", async () => {
    const sharedFileId = "FILE-SHARED-AB";
    const sharedUrl = `/api/v1/file/${sharedFileId}/download`;
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: sharedFileId,
      doctype: "File",
      docstatus: 0,
      file_name: "shared.pdf",
      file_url: sharedUrl,
      attached_to_entity: "SdBook",
      attached_to_name: "B-SHARE-A",
      attached_to_field: "attachment",
      is_private: true,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: new Date(),
      modified: new Date(),
    }, DIGITA.DATABASES.CORE);

    expect((await createBook({ _id: "B-SHARE-A", title: "Book A", code: "C-SHARE-A", attachment: sharedUrl })).statusCode).toBe(201);
    expect((await createBook({ _id: "B-SHARE-B", title: "Book B", code: "C-SHARE-B", attachment: sharedUrl })).statusCode).toBe(201);

    // A drops F: cleanupDocumentAttachments runs on A, but F remains active while B is live
    const dropRes = await app.inject({
      method: "PUT",
      url: "/api/v1/resource/SdBook/B-SHARE-A",
      headers: as(adminTok),
      payload: { attachment: null },
    });
    expect(dropRes.statusCode).toBe(200);

    let fileRecord = await db.findOne(DIGITA.COLLECTIONS.FILE, sharedFileId, DIGITA.DATABASES.CORE);
    expect(fileRecord?.["deleted"]).toBeUndefined();

    // Now mark B as deleted: F remains active while B is marked
    expect((await deleteBook("B-SHARE-B")).statusCode).toBe(200);
    const delAttempt = await app.inject({ method: "DELETE", url: `/api/v1/file/${sharedFileId}`, headers: as(adminTok) });
    expect(delAttempt.statusCode).toBe(409);
    expect(delAttempt.json().error.code).toBe("DELETE_BLOCKED");

    fileRecord = await db.findOne(DIGITA.COLLECTIONS.FILE, sharedFileId, DIGITA.DATABASES.CORE);
    expect(fileRecord?.["deleted"]).toBeUndefined();

    // Restore B: B is live again and still references F
    expect((await restoreBook("B-SHARE-B")).statusCode).toBe(200);
    const restoredB = await db.findOne("SdBook", "B-SHARE-B", "app");
    expect(restoredB?.["attachment"]).toBe(sharedUrl);
    fileRecord = await db.findOne(DIGITA.COLLECTIONS.FILE, sharedFileId, DIGITA.DATABASES.CORE);
    expect(fileRecord?.["deleted"]).toBeUndefined();

    // System-ID uppercase URL/request aliases also retain File
    const sysId = "607f1f77bcf86cd799439011";
    await db.insertOne(DIGITA.COLLECTIONS.FILE, {
      _id: new ObjectId(sysId),
      doctype: "File",
      docstatus: 0,
      file_name: "system-target.pdf",
      file_url: `/api/v1/file/${sysId}/download`,
      is_private: true,
      owner: "admin@d",
      modified_by: "admin@d",
      creation: new Date(),
      modified: new Date(),
    }, DIGITA.DATABASES.CORE);

    const upperUrl = `/api/v1/file/${sysId.toUpperCase()}/download`;
    expect((await createBook({ _id: "B-UPPER", title: "Upper Book", code: "C-UPPER", attachment: upperUrl })).statusCode).toBe(201);

    const upperDelRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/file/${sysId.toUpperCase()}`,
      headers: as(adminTok),
    });
    expect(upperDelRes.statusCode).toBe(409);
    expect(upperDelRes.json().error.code).toBe("DELETE_BLOCKED");

    const genericUpperDelRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/resource/File/${sysId.toUpperCase()}`,
      headers: as(adminTok),
    });
    expect(genericUpperDelRes.statusCode).toBe(409);
    expect(genericUpperDelRes.json().error.code).toBe("DELETE_BLOCKED");

    const sysDoc = await db.findOne(DIGITA.COLLECTIONS.FILE, sysId, DIGITA.DATABASES.CORE);
    expect(sysDoc?.["deleted"]).toBeUndefined();
  });

  it("PLANTED DEFECT: refuses restore before any hook runs for an actor holding delete permission but no read rights", async () => {
    expect((await createBook({ _id: "B-DELONLY", title: "For DeleteOnly", code: "C-DELONLY" })).statusCode).toBe(201);
    expect((await deleteBook("B-DELONLY")).statusCode).toBe(200);
    insertHooks.length = 0;

    const res = await restoreBook("B-DELONLY", deleteOnlyTok);
    expect(res.statusCode).toBe(403);
    expect(insertHooks).toEqual([]);
    const doc = await db.findOne("SdBook", "B-DELONLY", "app", undefined, { includeDeleted: true });
    expect(doc?.["deleted"]).toBeInstanceOf(Date);
  });

  it("PLANTED DEFECT: masks level-1 hidden fields through ordinary getDoc upon restore", async () => {
    expect((await createBook({
      _id: "B-MASK",
      title: "Masked",
      code: "C-MASK",
      secret_note: "CONFIDENTIAL_KEY",
    })).statusCode).toBe(201);
    expect((await deleteBook("B-MASK")).statusCode).toBe(200);

    // Clerk has level 0 read/write/delete, but NO level 1 read rights.
    const res = await restoreBook("B-MASK", clerkTok);
    expect(res.statusCode).toBe(200);
    expect(res.json().data._id).toBe("B-MASK");
    expect(res.json().data.title).toBe("Masked");
    expect(res.json().data.secret_note).toBeUndefined();

    // In database, the secret_note is preserved.
    const stored = await db.findOne("SdBook", "B-MASK", "app");
    expect(stored?.["secret_note"]).toBe("CONFIDENTIAL_KEY");

    // Administrator who holds level 1 read permission sees the field.
    const adminRead = await app.inject({ method: "GET", url: "/api/v1/resource/SdBook/B-MASK", headers: as(adminTok) });
    expect(adminRead.statusCode).toBe(200);
    expect(adminRead.json().data.secret_note).toBe("CONFIDENTIAL_KEY");
  });

  it("PLANTED DEFECT: direct documentService.restoreDoc masks level-1 hidden fields on returned BaseDocument", async () => {
    expect((await createBook({
      _id: "B-MASK-DS",
      title: "Direct Masked",
      code: "C-MASK-DS",
      secret_note: "CONFIDENTIAL_DIRECT",
    })).statusCode).toBe(201);
    expect((await deleteBook("B-MASK-DS")).statusCode).toBe(200);

    const clerkUser = { _id: "clerk@d", email: "clerk@d", roles: ["Clerk"] };
    const restoredDoc = await documentService.restoreDoc("SdBook", "B-MASK-DS", clerkUser);

    // Direct returned BaseDocument._data must have secret_note masked
    expect(restoredDoc.get("title")).toBe("Direct Masked");
    expect(restoredDoc.get("secret_note")).toBeUndefined();
    expect(restoredDoc._data["secret_note"]).toBeUndefined();

    // Database still preserves secret_note
    const stored = await db.findOne("SdBook", "B-MASK-DS", "app");
    expect(stored?.["secret_note"]).toBe("CONFIDENTIAL_DIRECT");
  });

  it("PLANTED DEFECT: ordinary update on marked row fails NotFound before post-hooks and rolls back same-Tx before hook writes", async () => {
    expect((await createBook({ _id: "B-UPDATE-MARKED", title: "Original Title", code: "C-UP-MARKED" })).statusCode).toBe(201);
    postUpdateHooks.length = 0;
    beforeSaveHooks.length = 0;
    const adminUser = { _id: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] };

    // The before_save hook marks the live row inside this same transaction.
    await expect(
      documentService.update("SdBook", "B-UPDATE-MARKED", { title: "Attempted Title Mutation" }, adminUser),
    ).rejects.toMatchObject({ status: 404 });

    // HTTP route also returns 404
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/resource/SdBook/B-UPDATE-MARKED",
      headers: as(adminTok),
      payload: { title: "HTTP Title Mutation" },
    });
    expect(putRes.statusCode).toBe(404);

    expect(beforeSaveHooks).toEqual(["B-UPDATE-MARKED", "B-UPDATE-MARKED"]);
    // The failed write rolls back both the hook's row marker and its side effect.
    const marker = await db.findOne("SdBookHookMarker", "marker-update-B-UPDATE-MARKED", "app");
    expect(marker).toBeNull();

    // Post-update hook never ran
    expect(postUpdateHooks).toEqual([]);

    // Document in database still retained with original values and deleted timestamp
    const kept = await db.findOne("SdBook", "B-UPDATE-MARKED", "app", undefined, { includeDeleted: true });
    expect(kept?.["title"]).toBe("Original Title");
    expect(kept?.["deleted"]).toBeUndefined();
  });

  it("PLANTED DEFECT: singleton seeds keep marked identities and normal restore recovers them", async () => {
    const adminUser = { _id: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] };
    const { seedBrandingSettings } = await import("../src/core/setup/seed-branding-settings.js");
    const { seedSystemSettings } = await import("../src/core/setup/seed-system-settings.js");
    for (const [entity, id] of [[DIGITA.COLLECTIONS.BRANDING_SETTING, "branding"], [DIGITA.COLLECTIONS.SETTING, "settings"]]) {
      await documentService.deleteDoc(entity!, id!, adminUser);
      await seedBrandingSettings(db);
      await seedSystemSettings(db);
      await expect(documentService.getSingle(entity!, adminUser)).rejects.toMatchObject({ status: 404 });
      expect((await db.findOne(entity!, id!, DIGITA.DATABASES.CORE, undefined, { includeDeleted: true }))?.["deleted"]).toBeInstanceOf(Date);
      const restored = await documentService.restoreDoc(entity!, id!, adminUser);
      expect(restored._id).toBe(id);
      expect((await db.findOne(entity!, id!, DIGITA.DATABASES.CORE))?.["deleted"]).toBeUndefined();
    }
  });
});


describe("soft delete at the database read boundary", () => {
  beforeAll(async () => {
    await db.insertOne("SdBook", { _id: "SD-CORE-DEL", title: "Kept", code: "SD-CORE-DEL", shelf: "SD-CORE-SHELF", deleted: new Date(), deleted_by: "admin@d" }, "app");
    await db.insertOne("SdBook", { _id: "SD-CORE-LIVE", title: "Live", code: "SD-CORE-LIVE", shelf: "SD-CORE-SHELF" }, "app");
    await db.insertOne("SdShelf", { _id: "SD-CORE-SHELF", label: "Read boundary" }, "app");
  });

  it.each([
    ["findOne", async (id: string) => (await db.findOne("SdBook", id, "app")) !== null],
    ["findOneByFilter", async (id: string) => (await db.findOneByFilter("SdBook", { code: id }, "app")) !== null],
    ["findManyByFilter", async (id: string) => (await db.findManyByFilter("SdBook", { code: id }, "app")).length > 0],
    ["find", async (id: string) => (await db.find("SdBook", { filters: [{ _id: id }] }, "app")).length > 0],
    ["count", async (id: string) => (await db.count("SdBook", [{ _id: id }], "app")) > 0],
    ["exists", async (id: string) => db.exists("SdBook", id, "app")],
    ["existsByField", async (id: string) => db.existsByField("SdBook", "code", id, "app")],
    ["aggregate", async (id: string) => (await db.aggregate("SdBook", [{ $match: { _id: id } }, { $project: { _id: 1 } }], "app")).length > 0],
  ] as const)("PLANTED DEFECT / INNOCENT: %s hides marked rows and keeps live rows", async (_method, reads) => {
    expect(await reads("SD-CORE-DEL")).toBe(false);
    expect(await reads("SD-CORE-LIVE")).toBe(true);
  });

  it.each([
    [{ $lookup: { from: "SdBook", localField: "_id", foreignField: "shelf", as: "books" } }],
    [{ $lookup: { from: "SdBook", let: { shelf: "$_id" }, pipeline: [{ $match: { $expr: { $eq: ["$shelf", "$$shelf"] } } }], as: "books" } }],
    [{ $graphLookup: { from: "SdBook", startWith: "$_id", connectFromField: "_id", connectToField: "shelf", as: "books" } }],
  ])("PLANTED DEFECT / INNOCENT: a joined collection hides deleted rows %j", async (stage) => {
    const [row] = await db.aggregate("SdShelf", [{ $match: { _id: "SD-CORE-SHELF" } }, stage], "app");
    expect((row?.["books"] as Array<{ _id: string }>).map((book) => book._id)).toEqual(["SD-CORE-LIVE"]);
  });

  it("PLANTED DEFECT / INNOCENT: a union source hides deleted rows before projection", async () => {
    const rows = await db.aggregate("SdShelf", [{ $match: { _id: "no row" } }, { $unionWith: { coll: "SdBook", pipeline: [{ $match: { shelf: "SD-CORE-SHELF" } }, { $project: { _id: 1 } }] } }], "app");
    expect(rows.map((row) => row["_id"])).toEqual(["SD-CORE-LIVE"]);
  });
});
