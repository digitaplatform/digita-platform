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
    BOOTSTRAP_LOCALE: "en", TRANSLATION_SOURCE: "file", TRANSLATION_CACHE: "none",
    TRANSLATION_CACHE_TTL_SEC: 0, TRANSLATION_SEED_ON_BOOT: false, TRANSLATION_FALLBACK_LOCALE: "en",
    API_RATE_LIMIT_MAX: 1000, API_RATE_LIMIT_WINDOW: "1m", API_MAX_BODY_SIZE: "10mb", API_TIMEOUT_MS: 60000,
    API_TRUSTED_PROXY_HOPS: 0, API_PUBLIC_CREATE_RATE_LIMIT_MAX: 1000, API_PUBLIC_CREATE_RATE_LIMIT_WINDOW: 60000,
    API_PUBLIC_CREATE_MAX_BODY_SIZE: "16kb",
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    UPLOAD_MAX_SIZE: "25mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: "./uploads",
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
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
import { ViewLogService } from "../src/core/version/view-log-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;
let clerkTok: string;
let outsiderTok: string;
let customerId: string;

/** A customer whose views are kept for its data-protection record; the Clerk may read it. */
const CUSTOMER: EntityDefinition = {
  name: "ViewLogCustomer",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "VLC-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: true,
  fields: [{ fieldname: "full_name", fieldtype: "Data", label: "Full name" }],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

const views = (tok: string) =>
  app.inject({ method: "GET", url: `/api/v1/resource/ViewLogCustomer/${customerId}/views`, headers: bearer(tok) });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(CUSTOMER);

  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk"] });
  outsiderTok = await ta.sign({ sub: "outsider@d", email: "outsider@d", roles: ["Outsider"] });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/resource/ViewLogCustomer",
    headers: bearer(adminTok),
    payload: { full_name: "Ada Muster" },
  });
  expect(created.statusCode).toBe(201);
  customerId = created.json().data._id as string;
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("GET /resource/:doctype/:name/views", () => {
  it("lists who viewed the record, for a user who may read it", async () => {
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/ViewLogCustomer/${customerId}`, headers: bearer(clerkTok) });
    expect(read.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const res = await views(adminTok);
      expect(res.statusCode).toBe(200);
      expect((res.json().data as Array<{ viewed_by: string }>).map((v) => v.viewed_by)).toEqual(["clerk@d"]);
    });
    const res = await views(clerkTok);
    expect(res.statusCode).toBe(200);
    const entry = (res.json().data as Array<{ viewed_by: string; timestamp: string }>).find((v) => v.viewed_by === "clerk@d")!;
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
  });

  // The log lists who opened the record; a read of the log itself opens nothing.
  it("logs no view when the log is read, and still logs a read of the record", async () => {
    const logView = vi.spyOn(ViewLogService.prototype, "logView");
    try {
      expect((await views(adminTok)).statusCode).toBe(200);
      expect((await views(clerkTok)).statusCode).toBe(200);
      expect(logView).not.toHaveBeenCalled();

      const read = await app.inject({ method: "GET", url: `/api/v1/resource/ViewLogCustomer/${customerId}`, headers: bearer(clerkTok) });
      expect(read.statusCode).toBe(200);
      expect(logView).toHaveBeenCalledExactlyOnceWith("ViewLogCustomer", customerId, "clerk@d");
    } finally {
      logView.mockRestore();
    }
  });

  it("refuses a user who may not read the record", async () => {
    const res = await views(outsiderTok);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain("clerk@d");
  });
});
