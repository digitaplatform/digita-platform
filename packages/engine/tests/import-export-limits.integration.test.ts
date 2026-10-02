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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: { register: (e: EntityDefinition) => void };
let adminTok: string;

const EXP: EntityDefinition = {
  name: "ExpDoc",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "EXP-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "shelf", fieldtype: "Data", label: "Shelf" },
    { fieldname: "genre", fieldtype: "Data", label: "Genre" },
  ],
  search_fields: ["title"],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, export: 1, import: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry as unknown as { register: (e: EntityDefinition) => void };
  await result.startup();
  await app.ready();
  registry.register(EXP);
  await db.ensureCollection("ExpDoc", "app");

  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("Import/Export — malformed input is 400, over-cap limit is 400", () => {
  it("400s an import with no rows array", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("400s an import with an empty rows array", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: { rows: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a well-formed import (explicit mode:insert — ExpDoc has no business_key)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: { rows: [{ title: "Imported" }], mode: "insert" } });
    expect(res.statusCode).toBe(200);
  });

  it("400s a default (upsert) import on a bk-less entity", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: { rows: [{ title: "X" }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.detail).toContain("import_upsert_requires_business_key");
  });

  it("400s an export whose limit exceeds EXPORT_MAX_ROWS", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/export/ExpDoc?limit=101", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(400);
  });

  it("400s an export with malformed filters JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/export/ExpDoc?filters=not-json", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(400);
  });

  it("accepts an export within the cap", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/export/ExpDoc?limit=50", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
  });
});

// A list narrows its rows with AND filters, OR filters and a search. An export for re-import
// must hold exactly those rows, or a re-import of the file touches rows the user filtered out.
describe("Export — holds the rows the list shows under its whole query", () => {
  it("answers the rows the list answers for the same filters, or_filters and search", async () => {
    const rows = [
      { title: "Rose poem", shelf: "A", genre: "Poetry" },
      { title: "Rose ode", shelf: "C", genre: "Poetry" },
      { title: "Tulip", shelf: "B", genre: "Poetry" },
      { title: "Rose song", shelf: "B", genre: "Prose" },
      { title: "Rose verse", shelf: "B", genre: "Poetry" },
    ];
    await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: { rows, mode: "insert" } });
    const query =
      `filters=${encodeURIComponent(JSON.stringify([["genre", "=", "Poetry"]]))}` +
      `&or_filters=${encodeURIComponent(JSON.stringify([["shelf", "=", "A"], ["shelf", "=", "B"]]))}` +
      "&search=rose";
    const titles = (data: { title: string }[]) => data.map((row) => row.title).sort();

    const listed = await app.inject({ method: "GET", url: `/api/v1/resource/ExpDoc?${query}`, headers: bearer(adminTok) });
    const exported = await app.inject({ method: "GET", url: `/api/v1/export/ExpDoc?round_trip=true&${query}`, headers: bearer(adminTok) });

    expect(listed.statusCode).toBe(200);
    expect(titles(listed.json().data)).toEqual(["Rose poem", "Rose verse"]);
    expect(exported.statusCode).toBe(200);
    expect(titles(exported.json().data)).toEqual(titles(listed.json().data));
  });

  it("400s an export with malformed or_filters JSON", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/export/ExpDoc?or_filters=not-json", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(400);
  });

  it("answers an export asked to apply filters only", async () => {
    const rows = [{ title: "Kept" }, { title: "Left out" }];
    await app.inject({ method: "POST", url: "/api/v1/import/ExpDoc", headers: bearer(adminTok), payload: { rows, mode: "insert" } });
    const filters = encodeURIComponent(JSON.stringify([["title", "=", "Kept"]]));
    const res = await app.inject({ method: "GET", url: `/api/v1/export/ExpDoc?filters=${filters}`, headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((row: { title: string }) => row.title)).toEqual(["Kept"]);
  });
});
