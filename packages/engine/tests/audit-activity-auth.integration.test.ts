import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Engine-only env (no APP_DIRS): the test registers its own entities.
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
    LOG_SEQ_ENABLED: false, LOG_SEQ_URL: "", LOG_SEQ_API_KEY: "",
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
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", LOCALES_DIR: "./src/locales",
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
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: { register: (e: EntityDefinition) => void };
let sign: (c: { sub: string; email: string; roles: string[]; tiers?: string[] }) => Promise<string>;

let adminTok: string; // Administrator
let userTok: string; // PortalUser (can read SecDoc, cannot read HiddenDoc)
let strangerTok: string; // System User with no grant on SecDoc/HiddenDoc
let secId: string;

/** A PortalUser-readable, change-tracked entity. */
const SEC: EntityDefinition = {
  name: "AuditSecDoc",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "ASEC-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: true,
  track_views: false,
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "PortalUser", level: 0, select: 1, read: 1, write: 1 },
  ],
} as unknown as EntityDefinition;

/** An entity PortalUser cannot select at all (admin-only). */
const HIDDEN: EntityDefinition = {
  ...SEC,
  name: "AuditHiddenDoc",
  naming: { strategy: "auto_increment", prefix: "AHID-", pad_length: 4 },
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  sign = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry as unknown as { register: (e: EntityDefinition) => void };
  await result.startup();
  await app.ready();

  registry.register(SEC);
  registry.register(HIDDEN);

  adminTok = await sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
  userTok = await sign({ sub: "op@d", email: "op@d", roles: ["PortalUser"], tiers: ["internal"] });
  strangerTok = await sign({ sub: "stranger@d", email: "stranger@d", roles: ["System User"], tiers: ["internal"] });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/resource/AuditSecDoc",
    headers: bearer(adminTok),
    payload: { title: "Public Title" },
  });
  expect(created.statusCode).toBe(201);
  secId = created.json().data._id as string;
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("Audit-leak fix — global /audit and /activity are Administrator-gated", () => {
  it("403s a non-admin GET /audit (field-level change history of ALL entities)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/audit", headers: bearer(userTok) });
    expect(res.statusCode).toBe(403);
  });

  it("403s a non-admin GET /activity (global operation stream of ALL entities)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/activity", headers: bearer(userTok) });
    expect(res.statusCode).toBe(403);
  });

  it("allows an admin GET /audit", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/audit", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
  });

  it("allows an admin GET /activity", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/activity", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
  });
});

describe("Audit-leak fix — per-document /activity/:entity/:name is read-gated (mirrors H1)", () => {
  it("allows a user who can read the document", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/activity/AuditSecDoc/${secId}`,
      headers: bearer(userTok),
    });
    expect(res.statusCode).toBe(200);
  });

  it("denies a caller with no read grant on the document's entity", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/activity/AuditSecDoc/${secId}`,
      headers: bearer(strangerTok),
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("denies a user on an entity it cannot select at all (existence not enumerable)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/activity/AuditHiddenDoc/AHID-0001`,
      headers: bearer(userTok),
    });
    expect([403, 404]).toContain(res.statusCode);
  });
});
