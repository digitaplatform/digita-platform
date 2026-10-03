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
// deleted records, and a person who may delete it brings it back whole, through its insert hooks.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { IndexManager } from "../src/core/database/index-manager.js";
import { DELETED_COLLECTION } from "../src/core/document/deleted-records.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;
let clerkTok: string;
let readerTok: string;
let shelverTok: string;
const insertHooks: string[] = [];

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
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Reader", level: 0, select: 1, read: 1 },
    { role: "Shelver", level: 0, select: 1, read: 1, delete: 1, condition: "doc.code == 'C-9'" },
  ],
} as unknown as EntityDefinition;

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const createBook = (payload: Record<string, unknown>, token = adminTok) =>
  app.inject({ method: "POST", url: "/api/v1/resource/SdBook", headers: as(token), payload });
const deleteBook = (name: string, token = adminTok) =>
  app.inject({ method: "DELETE", url: `/api/v1/resource/SdBook/${name}`, headers: as(token) });
const restoreBook = (name: string, token = adminTok) =>
  app.inject({ method: "POST", url: `/api/v1/resource/SdBook/deleted/${name}/restore`, headers: as(token) });
const listDeleted = (token = adminTok) =>
  app.inject({ method: "GET", url: "/api/v1/resource/SdBook/deleted", headers: as(token) });
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
  // The book's insert hooks, as an app module would declare them.
  const hooks = (result.hookRunner as unknown as { hooks: Map<string, Map<string, (doc: { _id: string }) => void>> }).hooks;
  hooks.set("SdBook", new Map([
    ["before_insert", (doc) => void insertHooks.push(`before_insert ${doc._id}`)],
    ["after_insert", (doc) => void insertHooks.push(`after_insert ${doc._id}`)],
  ]));
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk"] });
  readerTok = await ta.sign({ sub: "reader@d", email: "reader@d", roles: ["Reader"] });
  shelverTok = await ta.sign({ sub: "shelver@d", email: "shelver@d", roles: ["Shelver"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a deleted record", () => {
  it("PLANTED DEFECT: leaves every read of its entity and waits in the deleted records with its texts", async () => {
    expect((await createBook({ _id: "B1", title: "Gone", code: "C-1", copies: [{ barcode: "X1" }] })).statusCode).toBe(201);
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, titleTranslation("B1"), DIGITA.DATABASES.CORE);
    expect((await deleteBook("B1")).statusCode).toBe(200);

    const read = (url: string) => app.inject({ method: "GET", url, headers: as(adminTok) });
    expect((await read("/api/v1/resource/SdBook/B1")).statusCode).toBe(404);
    expect((await read("/api/v1/resource/SdBook")).json().data.map((r: { _id: string }) => r._id)).not.toContain("B1");
    expect((await read("/api/v1/resource/SdBook/count")).json().data.count).toBe(0);
    expect(await db.findOne("SdBook", "B1", "app")).toBeNull();

    const kept = await db.findOne(DELETED_COLLECTION, "SdBook:B1", DIGITA.DATABASES.AUDITS);
    expect(kept).toMatchObject({ entity: "SdBook", document_name: "B1", deleted_by: "admin@d", record: { title: "Gone", code: "C-1" } });
    expect((kept!["translations"] as unknown[]).length).toBe(1);
    const texts = await db.findManyByFilter(DIGITA.COLLECTIONS.TRANSLATION, { entity: "SdBook", document_name: "B1" }, DIGITA.DATABASES.CORE);
    expect(texts).toEqual([]);
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
    expect(await db.findOne(DELETED_COLLECTION, "SdBook:B2", DIGITA.DATABASES.AUDITS)).toBeNull();

    const german = await app.inject({ method: "GET", url: "/api/v1/resource/SdBook/B2", headers: { ...as(adminTok), "accept-language": "de" } });
    expect(german.json().data.title).toBe("Titel B2");
    const log = await db.findManyByFilter(DIGITA.COLLECTIONS.LOG, { entity: "SdBook", document_name: "B2" }, DIGITA.DATABASES.LOGS);
    expect(log.map((row) => row["action"])).toEqual(expect.arrayContaining(["Deleted", "Restored"]));
  });

  it("frees its id and unique values for a new record, and a restore that meets them is refused by the field", async () => {
    expect((await createBook({ _id: "B3", title: "First", code: "C-3" })).statusCode).toBe(201);
    expect((await deleteBook("B3")).statusCode).toBe(200);
    expect((await createBook({ _id: "B3", title: "Second", code: "C-3b" })).statusCode).toBe(201);
    const byId = await restoreBook("B3");
    expect([byId.statusCode, byId.json().error.field]).toEqual([409, "_id"]);

    expect((await createBook({ _id: "B4", title: "Coded", code: "C-4" })).statusCode).toBe(201);
    expect((await deleteBook("B4")).statusCode).toBe(200);
    expect((await createBook({ _id: "B5", title: "Took the code", code: "C-4" })).statusCode).toBe(201);
    const byCode = await restoreBook("B4");
    expect([byCode.statusCode, byCode.json().error.field]).toEqual([409, "code"]);
    expect(await db.findOne(DELETED_COLLECTION, "SdBook:B4", DIGITA.DATABASES.AUDITS)).not.toBeNull();
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
    expect(listed[0]).toMatchObject({ name: "B7", title: "Clerk's", deleted_by: "clerk@d" });
    expect((await restoreBook("B7", clerkTok)).statusCode).toBe(200);
  });

  it("PLANTED DEFECT: is listed and restored only where the person's delete row admits it", async () => {
    for (const [name, code] of [["B9", "C-9"], ["B10", "C-10"]]) {
      expect((await createBook({ _id: name, title: name, code })).statusCode).toBe(201);
      expect((await deleteBook(name!)).statusCode).toBe(200);
    }
    const listed = (await listDeleted(shelverTok)).json().data as Array<Record<string, unknown>>;
    expect(listed.map((row) => row["name"])).toEqual(["B9"]);
    expect((await restoreBook("B10", shelverTok)).statusCode).toBe(403);
    expect((await restoreBook("B9", shelverTok)).statusCode).toBe(200);
  });

  it("keeps one deleted record per name: a second delete of the name replaces the first", async () => {
    expect((await createBook({ _id: "B8", title: "Old", code: "C-8" })).statusCode).toBe(201);
    expect((await deleteBook("B8")).statusCode).toBe(200);
    expect((await createBook({ _id: "B8", title: "New", code: "C-8n" })).statusCode).toBe(201);
    expect((await deleteBook("B8")).statusCode).toBe(200);
    expect((await restoreBook("B8")).json().data.title).toBe("New");
  });
});
