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
  name: "SideReadCustomer",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "SRC-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: true,
  track_views: true,
  fields: [{ fieldname: "full_name", fieldtype: "Data", label: "Full name" }],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

/** The panels a record page reads beside the record; none of them is a view of it. */
const SIDE_ROUTES: Array<[string, () => string]> = [
  ["versions", () => `/api/v1/resource/SideReadCustomer/${customerId}/versions`],
  ["related", () => `/api/v1/resource/SideReadCustomer/${customerId}/related`],
  ["shares", () => `/api/v1/resource/SideReadCustomer/${customerId}/shares`],
  ["activity", () => `/api/v1/activity/SideReadCustomer/${customerId}`],
];

const get = (url: string, tok: string) => app.inject({ method: "GET", url, headers: bearer(tok) });

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
    url: "/api/v1/resource/SideReadCustomer",
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

describe("the side panels of a record with track_views", () => {
  it.each(SIDE_ROUTES)("logs no view when %s is read", async (_panel, url) => {
    const logView = vi.spyOn(ViewLogService.prototype, "logView");
    try {
      expect((await get(url(), clerkTok)).statusCode).toBe(200);
      expect(logView).not.toHaveBeenCalled();
    } finally {
      logView.mockRestore();
    }
  });

  it.each(SIDE_ROUTES)("refuses %s to a user who may not read the record", async (_panel, url) => {
    expect((await get(url(), outsiderTok)).statusCode).toBe(403);
  });

  it("logs exactly one view when the record itself is read", async () => {
    const logView = vi.spyOn(ViewLogService.prototype, "logView");
    try {
      expect((await get(`/api/v1/resource/SideReadCustomer/${customerId}`, clerkTok)).statusCode).toBe(200);
      expect(logView).toHaveBeenCalledExactlyOnceWith("SideReadCustomer", customerId, "clerk@d");
    } finally {
      logView.mockRestore();
    }
  });
});
