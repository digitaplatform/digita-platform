import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Same env mock as the resource-api integration test, but with APP_DIRS pointing
// at the web-content app so its Guest-readable entities (WebSite/WebPage/…) load.
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
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    UPLOAD_MAX_SIZE: "25mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: "./uploads",
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: ["../../../digita-apps/web"], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", LOCALES_DIR: "./src/locales",
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false, PERMISSION_SCOPE_ENABLED: false,
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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { existsSync } from "node:fs";

// The web-content app now lives in the separate digita-apps repo. This is a
// cross-repo integration test (engine + the web app): run it when digita-apps is
// checked out as a sibling (local / integration), skip it in engine-only CI.
const APPS_PRESENT = existsSync("../../../digita-apps/web");

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminToken: string;

const PUB = "/api/v1/public/resource/WebPage";
const now = new Date();
const baseRow = (over: Record<string, unknown>) => ({
  doctype: "WebPage", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now,
  site: "t-site", locale: "en", blocks: [], ...over,
});

beforeAll(async () => {
  if (!APPS_PRESENT) return; // suite skipped below; don't boot without the app
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();

  adminToken = await ta.sign({
    sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"],
  });

  // Seed directly (raw insert, like seed-app-data) into the web_content DB.
  await db.insertOne("WebSite", { doctype: "WebSite", docstatus: 0, owner: "system", _id: "t-site", site_name: "Test Site", default_locale: "en", status: "published", creation: now, modified: now }, "web_content");
  await db.insertOne("WebPage", baseRow({ _id: "t-site::en::", slug: "", title: "Home", status: "published" }), "web_content");
  await db.insertOne("WebPage", baseRow({ _id: "t-site::en::draft", slug: "draft", title: "Draft", status: "draft" }), "web_content");
}, 60000);

afterAll(async () => {
  if (!APPS_PRESENT) return;
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe.skipIf(!APPS_PRESENT)("Public read scope (generic Guest)", () => {
  it("anonymously lists ONLY published rows (drafts gated by the per-doc condition)", async () => {
    const res = await app.inject({ method: "GET", url: PUB });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ _id: string }>).map((r) => r._id);
    expect(ids).toContain("t-site::en::");
    expect(ids).not.toContain("t-site::en::draft");
  });

  it("anonymously reads a published page", async () => {
    const res = await app.inject({ method: "GET", url: `${PUB}/t-site::en::` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Home");
  });

  it("denies anonymous read of a DRAFT page", async () => {
    const res = await app.inject({ method: "GET", url: `${PUB}/t-site::en::draft` });
    expect(res.statusCode).not.toBe(200); // PermissionDenied (condition: status==published)
  });

  it("denies anonymous read of a NON-public entity (no Guest permission)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/public/resource/BrandingSetting" });
    expect(res.statusCode).not.toBe(200);
  });

  it("an authenticated admin CAN read a draft via the public scope (optionalAuth keeps identity)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${PUB}/t-site::en::draft`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Draft");
  });

  it("strips operator identity (owner / modified_by) from public responses", async () => {
    const one = await app.inject({ method: "GET", url: `${PUB}/t-site::en::` });
    expect(one.json().data.owner).toBeUndefined();
    expect(one.json().data.modified_by).toBeUndefined();
    const list = await app.inject({ method: "GET", url: PUB });
    for (const row of list.json().data as Array<Record<string, unknown>>) {
      expect(row.owner).toBeUndefined();
      expect(row.modified_by).toBeUndefined();
    }
  });

  it("clamps an oversized page_size (anonymous DoS guard)", async () => {
    const res = await app.inject({ method: "GET", url: `${PUB}?page_size=100000000` });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.page_size).toBeLessThanOrEqual(200);
  });

  it("clamps page_size=0 to a bounded value (Mongo treats limit 0 as unbounded → DoS)", async () => {
    const res = await app.inject({ method: "GET", url: `${PUB}?page_size=0` });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.page_size).toBeGreaterThanOrEqual(1);
    expect(res.json().meta.page_size).toBeLessThanOrEqual(200);
  });

  it("clamps limit=0 to a bounded value", async () => {
    const res = await app.inject({ method: "GET", url: `${PUB}?limit=0` });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.page_size).toBeGreaterThanOrEqual(1);
    expect(res.json().meta.page_size).toBeLessThanOrEqual(200);
  });
});
