import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
// The public create (digitaplatform/digita-platform#36): POST /api/v1/public/resource/:doctype, always
// as Guest. The env mock is site-scope.integration.test.ts's, on a website engine of site-a, behind one
// trusted proxy, with a route budget of 3 per visitor and a 1 kb body.
vi.mock("../src/core/config/env.js", () => {
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
    API_TRUSTED_PROXY_HOPS: 1, API_PUBLIC_CREATE_RATE_LIMIT_MAX: 3, API_PUBLIC_CREATE_RATE_LIMIT_WINDOW: 60000,
    API_PUBLIC_CREATE_MAX_BODY_SIZE: "1kb",
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    UPLOAD_MAX_SIZE: "25mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: "./uploads",
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [] as string[], SITE_ID: "site-a", ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
    SEED_APP_DATA_ON_BOOT: false, SEED_DEMO_DATA_ON_BOOT: false,
    // Its entities grant Guest read, so start-up needs the renderer's purge route; nothing listens there.
    REVALIDATE_URL: "http://127.0.0.1:9/api/revalidate", REVALIDATE_SECRET: "test-revalidate-secret",
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
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// A self-contained fixture app: domain-loaded entities get the database <appDir-basename>_<domain>.
const APP_BASENAME = "digita-public-create-fixture";
const DB = `${APP_BASENAME}_content`;
const PUB = "/api/v1/public/resource";
const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}

async function writeFixture(): Promise<string> {
  const appDir = join(tmpdir(), APP_BASENAME);
  await rm(appDir, { recursive: true, force: true });
  const entities = join(appDir, "content", "entities");
  await writeJson(join(entities, "WebSite.entity.json"), {
    name: "WebSite", module: "web", database: DB, naming: { strategy: "user_set" }, title_field: "site_name",
    fields: [{ fieldname: "site_name", fieldtype: "Data", label: "Site Name", required: true }],
    permissions: [ADMIN, { role: "Guest", level: 0, select: 1, read: 1 }],
  });
  // Opened by its Guest row: create and write at level 0.
  await writeJson(join(entities, "Lead.entity.json"), {
    name: "Lead", module: "web", database: DB, naming: { strategy: "system" },
    fields: [
      { fieldname: "site", fieldtype: "Link", label: "Site", target: "WebSite" },
      { fieldname: "email", fieldtype: "Data", label: "Email", required: true },
      { fieldname: "message", fieldtype: "Text", label: "Message", required: true },
      { fieldname: "topic", fieldtype: "Select", label: "Topic", options: ["contact", "trial"], default: "contact" },
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["new", "spam"], default: "new", read_only: true },
      { fieldname: "note", fieldtype: "TextEditor", label: "Note" },
      { fieldname: "rating", fieldtype: "Int", label: "Internal rating", perm_level: 1 },
    ],
    permissions: [ADMIN, { role: "Guest", level: 0, create: 1, write: 1 }],
  });
  // Guest may read it, not create it; and one Guest has no row on at all.
  await writeJson(join(entities, "Notice.entity.json"), {
    name: "Notice", module: "web", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "text", fieldtype: "Data", label: "Text" }],
    permissions: [ADMIN, { role: "Guest", level: 0, select: 1, read: 1 }],
  });
  await writeJson(join(entities, "Internal.entity.json"), {
    name: "Internal", module: "web", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "text", fieldtype: "Data", label: "Text" }],
    permissions: [ADMIN],
  });
  // Its id comes from a field, which a visitor must never choose.
  await writeJson(join(entities, "NamedLead.entity.json"), {
    name: "NamedLead", module: "web", database: DB, naming: { strategy: "by_field", field: "code" },
    fields: [
      { fieldname: "code", fieldtype: "Data", label: "Code" },
      { fieldname: "text", fieldtype: "Data", label: "Text" },
    ],
    permissions: [ADMIN, { role: "Guest", level: 0, create: 1, write: 1 }],
  });
  // Its id is interpolated from a field by an expression.
  await writeJson(join(entities, "CodedLead.entity.json"), {
    name: "CodedLead", module: "web", database: DB, naming: { strategy: "expression", expression: "L-{code}" },
    fields: [
      { fieldname: "code", fieldtype: "Data", label: "Code" },
      { fieldname: "text", fieldtype: "Data", label: "Text" },
    ],
    permissions: [ADMIN, { role: "Guest", level: 0, create: 1, write: 1 }],
  });
  // Site-scoped, but its Guest row cannot write the site: a misconfigured entity.
  await writeJson(join(entities, "LockedLead.entity.json"), {
    name: "LockedLead", module: "web", database: DB, naming: { strategy: "system" },
    fields: [
      { fieldname: "site", fieldtype: "Link", label: "Site", target: "WebSite", read_only: true },
      { fieldname: "text", fieldtype: "Data", label: "Text" },
    ],
    permissions: [ADMIN, { role: "Guest", level: 0, create: 1, write: 1 }],
  });
  await writeJson(join(appDir, "content", "sites", "site-a", "WebSite.seed.json"), [{ _id: "site-a", site_name: "Site A" }]);
  return appDir;
}

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminToken: string;
let fixtureRoot: string;

const post = (doctype: string, body: unknown, visitor: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: `${PUB}/${doctype}`,
    payload: body as Record<string, unknown>,
    headers: { "x-forwarded-for": visitor, ...headers },
  });
const leads = () => db.count("Lead", [], DB);
const valid = { email: "visitor@example.com", message: "Please call me back." };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = await writeFixture();
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  adminToken = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] });
}, 60000);

afterAll(async () => {
  await app?.close();
  await db?.disconnect();
  await rm(fixtureRoot, { recursive: true, force: true });
  await replSet?.stop();
}, 30000);

describe("POST /api/v1/public/resource/:doctype", () => {
  it("creates as Guest, takes the site from the engine, and answers only the new id", async () => {
    const res = await post("Lead", { ...valid, topic: "trial" }, "203.0.113.1");
    expect(res.statusCode).toBe(201);
    const data = res.json().data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["_id"]);
    const stored = await db.findOne("Lead", String(data["_id"]), DB);
    expect(stored).toMatchObject({ site: "site-a", email: "visitor@example.com", topic: "trial", status: "new" });
  });

  it("refuses, and names, every key Guest may not set, and stores nothing", async () => {
    const before = await leads();
    // Every attempt counts against the visitor's budget, a refused one too, so each key comes
    // from a visitor of its own.
    const refusals = [
      ["_id", "chosen-id"], ["owner", "someone"], ["docstatus", 1], ["unknown", "x"],
      ["status", "spam"], ["site", "site-b"], ["note", "<img src=x onerror=alert(1)>"], ["rating", 5],
    ] as const;
    for (const [i, [key, value]] of refusals.entries()) {
      const res = await post("Lead", { ...valid, [key]: value }, `198.51.100.${i + 1}`);
      expect(res.statusCode, key).toBe(400);
      expect((res.json().error as { detail: string }).detail, key).toContain(`"${key}"`);
    }
    expect(await leads()).toBe(before);
  });

  it("refuses a body that is no object, and one that misses a required field", async () => {
    expect((await post("Lead", [valid], "203.0.113.3")).statusCode).toBe(400);
    expect((await post("Lead", { email: "visitor@example.com" }, "203.0.113.3")).statusCode).toBe(400);
    const nullBody = await app.inject({
      method: "POST", url: `${PUB}/Lead`, payload: "null",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    });
    expect(nullBody.statusCode).toBe(400);
  });

  it("takes no form post, which a page of another site could send with the visitor's cookies", async () => {
    const res = await app.inject({
      method: "POST", url: `${PUB}/Lead`, payload: "email=a%40b.c&message=hi",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.10" },
    });
    expect(res.statusCode).toBe(415);
  });

  it("refuses every field the id is made of, by_field or expression", async () => {
    for (const [doctype, visitor] of [["NamedLead", "203.0.113.11"], ["CodedLead", "203.0.113.13"]] as const) {
      const res = await post(doctype, { code: "chosen", text: "x" }, visitor);
      expect(res.statusCode, doctype).toBe(400);
      expect((res.json().error as { detail: string }).detail, doctype).toContain('"code"');
    }
  });

  it("fails as the server's fault when a site-scoped entity's Guest row cannot write the site", async () => {
    const before = await db.count("LockedLead", [], DB);
    expect((await post("LockedLead", { text: "x" }, "203.0.113.12")).statusCode).toBe(500);
    expect(await db.count("LockedLead", [], DB)).toBe(before);
  });

  it("answers 403 where the entity grants Guest no create, and 404 for no entity", async () => {
    expect((await post("Notice", { text: "x" }, "203.0.113.4")).statusCode).toBe(403);
    expect((await post("Internal", { text: "x" }, "203.0.113.4")).statusCode).toBe(403);
    expect((await post("NoSuchThing", { text: "x" }, "203.0.113.4")).statusCode).toBe(404);
  });

  it("runs as Guest even for a signed-in caller", async () => {
    const res = await post("Lead", { ...valid, status: "spam" }, "203.0.113.5", { authorization: `Bearer ${adminToken}` });
    expect(res.statusCode).toBe(400);
    const internal = await post("Internal", { text: "x" }, "203.0.113.5", { authorization: `Bearer ${adminToken}` });
    expect(internal.statusCode).toBe(403);
  });

  it("gives each visitor a budget of its own, far below the engine-wide one", async () => {
    for (let i = 0; i < 3; i++) expect((await post("Lead", valid, "203.0.113.6")).statusCode).toBe(201);
    expect((await post("Lead", valid, "203.0.113.6")).statusCode).toBe(429);
    expect((await post("Lead", valid, "203.0.113.7")).statusCode).toBe(201);
  });

  it("refuses a body over its limit", async () => {
    const res = await post("Lead", { ...valid, message: "x".repeat(2000) }, "203.0.113.8");
    expect(res.statusCode).toBe(413);
  });
});
