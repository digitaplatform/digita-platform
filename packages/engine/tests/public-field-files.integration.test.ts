import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", async () => {
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const uploadDir = join(
    tmpdir(),
    `digita-public-field-files-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  return { env: {
    NODE_ENV: "test", APP_VERSION: "0.1.0", SERVICE_NAME: "digita-test", PORT: 0, HOST: "127.0.0.1",
    BASE_URL: "http://localhost:3000", API_PREFIX: "/api/v1",
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
    REDIS_URI: "redis://localhost:6379", REDIS_PREFIX: "test:", REDIS_PASSWORD: "",
    JWT_SECRET: "test-secret-key-at-least-32-chars-long", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL: "7d",
    PASSWORD_HASH_ROUNDS: 4, SESSION_MAX_AGE_SEC: 86400, MAX_LOGIN_ATTEMPTS: 5, LOGIN_LOCKOUT_SEC: 900,
    TOTP_ISSUER: "Test", TOTP_ENABLED: false,
    LOG_LEVEL: "error", LOG_PRETTY: false, LOG_TO_FILE: false, LOG_FILE_PATH: "./logs",
    LOG_FILE_MAX_SIZE: "50M", LOG_FILE_MAX_FILES: 10, LOG_FILE_ROTATE: "daily",
    LOG_TO_MONGO: false, LOG_MONGO_TTL_DAYS: 30,
    LOG_REDACT_FIELDS: ["password", "secret", "token", "authorization"],
    BOOTSTRAP_LOCALE: "en", TRANSLATION_SOURCE: "file", TRANSLATION_CACHE: "none",
    TRANSLATION_CACHE_TTL_SEC: 0, TRANSLATION_SEED_ON_BOOT: false, TRANSLATION_FALLBACK_LOCALE: "en",
    API_RATE_LIMIT_MAX: 1000, API_RATE_LIMIT_WINDOW: "1m", API_MAX_BODY_SIZE: "10mb", API_TIMEOUT_MS: 60000,
    API_TRUSTED_PROXY_HOPS: 0, API_PUBLIC_CREATE_RATE_LIMIT_MAX: 1000, API_PUBLIC_CREATE_RATE_LIMIT_WINDOW: 60000,
    API_PUBLIC_CREATE_MAX_BODY_SIZE: "16kb",
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    // Small fileSize limit so the truncation guard is testable without MB payloads.
    UPLOAD_MAX_SIZE: "64kb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: uploadDir,
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.*"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
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
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { publishFilesOfPublicFields } from "../src/core/storage/public-field-files.js";

// A field that becomes `public: true` after files were uploaded to it: a boot step moves those
// files, and the URLs their rows hold, forward to public. A file of a private field, a file no row
// holds, a file of a private field that shares its name with a public one, a file that another row
// than its own copies into a public field, and a colleague's upload that names no row stay private.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: EntityRegistry;
let ta: Awaited<ReturnType<typeof buildTestAuth>>;
let adminToken: string;
let appDir: string;

const shop = (isPublic: boolean): EntityDefinition =>
  ({
    name: "TestShopItem",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    storage_path: "shopitems",
    fields: [
      { fieldname: "image", fieldtype: "AttachImage", label: "Image", ...(isPublic ? { public: true } : {}) },
      { fieldname: "invoice_scan", fieldtype: "Attach", label: "Invoice scan" },
      {
        fieldname: "images",
        fieldtype: "Table",
        label: "Images",
        child_fields: [
          { fieldname: "picture", fieldtype: "AttachImage", label: "Picture", ...(isPublic ? { public: true } : {}) },
          { fieldname: "caption", fieldtype: "Data", label: "Caption" },
        ],
      },
      {
        fieldname: "receipts",
        fieldtype: "Table",
        label: "Receipts",
        child_fields: [{ fieldname: "picture", fieldtype: "AttachImage", label: "Picture" }],
      },
    ],
    permissions: [],
  }) as unknown as EntityDefinition;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  ta = await buildTestAuth();
  appDir = await mkdtemp(join(tmpdir(), "digita-public-field-files-app-"));
  const booted = await createApp({ authn: ta.authn });
  app = booted.app;
  db = booted.db;
  registry = booted.registry;
  await booted.startup();
  await app.ready();
  registry.register(shop(false));
  adminToken = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator"] });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
  await rm(env.UPLOAD_LOCAL_PATH, { recursive: true, force: true });
  await rm(appDir, { recursive: true, force: true });
}, 30000);

async function upload(field: string, name: string, bytes: string, row?: string, token = adminToken): Promise<{ _id: string; file_url: string }> {
  const boundary = "----digitaPublicFieldFiles";
  const part = (header: string, body: string | Buffer) => [Buffer.from(`--${boundary}\r\n${header}\r\n\r\n`), Buffer.from(body), Buffer.from("\r\n")];
  const payload = Buffer.concat([
    ...part(`content-disposition: form-data; name="attached_to_entity"`, "TestShopItem"),
    ...part(`content-disposition: form-data; name="attached_to_field"`, field),
    ...(row ? part(`content-disposition: form-data; name="attached_to_name"`, row) : []),
    ...part(`content-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/pdf`, bytes),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/upload",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().data;
}

const publicFile = (id: string) => app.inject({ method: "GET", url: `/api/v1/public/file/${id}` });

/** A second engine on the same database, whose app directory declares the fields public: the start
 *  that runs every boot step in the order the engine runs them. */
async function bootWithPublicFields(): Promise<void> {
  await mkdir(join(appDir, "entities"), { recursive: true });
  await writeFile(join(appDir, "entities", "TestShopItem.entity.json"), JSON.stringify(shop(true)));
  const appDirs = env.APP_DIRS;
  (env as { APP_DIRS: string[] }).APP_DIRS = [appDir];
  const next = await createApp({ authn: ta.authn });
  try {
    await next.startup();
  } finally {
    await next.app.close();
    await next.db.disconnect();
    (env as { APP_DIRS: string[] }).APP_DIRS = appDirs;
  }
}
const fileRow = (id: string) => db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE) as Promise<Record<string, unknown>>;

describe("Files of a field that became public", () => {
  it("are public after the boot step, with the public URL in the File, the row and the Table cell", async () => {
    const main = await upload("image", "main.pdf", "main picture", "ITEM-1");
    const gallery = await upload("picture", "gallery.pdf", "gallery picture", "ITEM-1");
    const scan = await upload("invoice_scan", "scan.pdf", "private scan", "ITEM-1");
    // Uploaded for a public field of a row that does not hold it.
    const loose = await upload("image", "loose.pdf", "never saved to a row", "ITEM-1");
    // Uploaded for a public field, names no row, and another row's public cell holds it.
    const unnamed = await upload("picture", "unnamed.pdf", "nobody's row");
    // Held by the private `receipts[].picture` of its own row, which shares its name with the public
    // `images[].picture`, and copied into a public cell of another row.
    const receipt = await upload("picture", "receipt.pdf", "private receipt", "ITEM-1");
    // A boot stopped after the rows moved: the row holds the public URL, the File is still private.
    const halfway = await upload("picture", "halfway.pdf", "moved row", "ITEM-2");
    for (const file of [main, gallery, scan, loose, unnamed, receipt, halfway]) {
      expect(file.file_url).toBe(`/api/v1/file/${file._id}/download`);
      expect((await publicFile(file._id)).statusCode).toBe(404);
    }
    await db.insertOne("TestShopItem", {
      _id: "ITEM-1", doctype: "TestShopItem", docstatus: 0, image: main.file_url, invoice_scan: scan.file_url,
      images: [{ _row_id: "r1", idx: 1, picture: gallery.file_url, caption: "side" }, { _row_id: "r2", idx: 2, picture: null, caption: "none" }],
      receipts: [{ _row_id: "r3", idx: 1, picture: receipt.file_url }],
    }, DIGITA.DATABASES.CORE);
    await db.insertOne("TestShopItem", {
      _id: "ITEM-2", doctype: "TestShopItem", docstatus: 0,
      images: [
        { _row_id: "r4", idx: 1, picture: `/api/v1/public/file/${halfway._id}` },
        { _row_id: "r5", idx: 2, picture: receipt.file_url },
        { _row_id: "r6", idx: 3, picture: unnamed.file_url },
      ],
    }, DIGITA.DATABASES.CORE);

    registry.register(shop(true));
    await publishFilesOfPublicFields(db, registry.getAll());

    for (const file of [main, gallery, halfway]) {
      const res = await publicFile(file._id);
      expect(res.statusCode).toBe(200);
      const stored = await fileRow(file._id);
      expect(stored["is_private"]).toBe(false);
      expect(stored["file_url"]).toBe(`/api/v1/public/file/${file._id}`);
    }
    expect((await publicFile(main._id)).body).toBe("main picture");
    const item = (await db.findOne("TestShopItem", "ITEM-1", DIGITA.DATABASES.CORE)) as Record<string, unknown>;
    expect(item["image"]).toBe(`/api/v1/public/file/${main._id}`);
    expect(item["images"]).toEqual([
      { _row_id: "r1", idx: 1, picture: `/api/v1/public/file/${gallery._id}`, caption: "side" },
      { _row_id: "r2", idx: 2, picture: null, caption: "none" },
    ]);

    // The private field's file stays private, and so does its URL in the row.
    expect((await publicFile(scan._id)).statusCode).toBe(404);
    expect((await fileRow(scan._id))["is_private"]).toBe(true);
    expect(item["invoice_scan"]).toBe(scan.file_url);
    for (const file of [loose, unnamed, receipt]) {
      expect((await publicFile(file._id)).statusCode).toBe(404);
      expect((await fileRow(file._id))["is_private"]).toBe(true);
    }
    expect(item["receipts"]).toEqual([{ _row_id: "r3", idx: 1, picture: receipt.file_url }]);
    const other = (await db.findOne("TestShopItem", "ITEM-2", DIGITA.DATABASES.CORE)) as Record<string, unknown>;
    expect(other["images"]).toEqual([
      { _row_id: "r4", idx: 1, picture: `/api/v1/public/file/${halfway._id}` },
      { _row_id: "r5", idx: 2, picture: receipt.file_url },
      { _row_id: "r6", idx: 3, picture: unnamed.file_url },
    ]);
  });

  it("changes nothing on a second run", async () => {
    const before = await db.findManyByFilter(DIGITA.COLLECTIONS.FILE, { attached_to_entity: "TestShopItem" }, DIGITA.DATABASES.CORE);
    const itemsBefore = await db.findManyByFilter("TestShopItem", {}, DIGITA.DATABASES.CORE);
    await publishFilesOfPublicFields(db, registry.getAll());
    expect(await db.findManyByFilter(DIGITA.COLLECTIONS.FILE, { attached_to_entity: "TestShopItem" }, DIGITA.DATABASES.CORE)).toEqual(before);
    expect(await db.findManyByFilter("TestShopItem", {}, DIGITA.DATABASES.CORE)).toEqual(itemsBefore);
  });
});

describe("The first start after the upgrade that makes the fields public", () => {
  let colleagueFile: { _id: string; file_url: string };
  let merchantFile: { _id: string; file_url: string };

  beforeAll(async () => {
    registry.register(shop(false));
    const colleagueToken = await ta.sign({ sub: "colleague@digita.local", email: "colleague@digita.local", roles: ["System User"] });
    const merchantToken = await ta.sign({ sub: "merchant@digita.local", email: "merchant@digita.local", roles: ["System User"] });
    // A colleague's private upload that names no row; an attacker wrote its URL into a public cell of
    // their own row, a row written before a save refused a file its saver may not read.
    colleagueFile = await upload("picture", "colleague.pdf", "colleague's private picture", undefined, colleagueToken);
    await db.insertOne("TestShopItem", {
      _id: "ITEM-3", doctype: "TestShopItem", docstatus: 0, owner: "attacker@digita.local",
      images: [{ _row_id: "r7", idx: 1, picture: colleagueFile.file_url, caption: "planted" }],
    }, DIGITA.DATABASES.CORE);
    // The planted innocent case: a merchant's own upload in their own row, saved before a save named
    // its document.
    merchantFile = await upload("image", "merchant.pdf", "merchant's picture", undefined, merchantToken);
    await db.insertOne("TestShopItem", {
      _id: "ITEM-4", doctype: "TestShopItem", docstatus: 0, owner: "merchant@digita.local", image: merchantFile.file_url,
    }, DIGITA.DATABASES.CORE);

    // An Administrator, who may write every File, saves the attacker's row as the app does.
    registry.register(shop(true));
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/resource/TestShopItem/ITEM-3",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { images: [{ _row_id: "r7", idx: 1, picture: colleagueFile.file_url, caption: "approved" }] },
    });
    expect(saved.statusCode, saved.body).toBe(200);

    // The database the upgrade meets has not yet attached its legacy loose uploads.
    await db.deleteOne("_migrations", "attach-legacy-loose-files", DIGITA.DATABASES.CORE);
    await bootWithPublicFields();
  }, 60000);

  it("keeps private a colleague's upload that an Administrator's save of another user's row names", async () => {
    expect((await publicFile(colleagueFile._id)).statusCode).toBe(404);
    const stored = await fileRow(colleagueFile._id);
    expect(stored["is_private"]).toBe(true);
    expect(stored["attached_to_name"]).toBeUndefined();
  });

  it("publishes a legacy upload its uploader's row holds in a public field, at the start that attaches it", async () => {
    const res = await publicFile(merchantFile._id);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("merchant's picture");
    const stored = await fileRow(merchantFile._id);
    expect(stored["attached_to_name"]).toBe("ITEM-4");
    expect(stored["is_private"]).toBe(false);
    const item = (await db.findOne("TestShopItem", "ITEM-4", DIGITA.DATABASES.CORE)) as Record<string, unknown>;
    expect(item["image"]).toBe(`/api/v1/public/file/${merchantFile._id}`);
  });
});
