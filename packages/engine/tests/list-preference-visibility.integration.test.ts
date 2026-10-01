import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// A saved view's visibility is kept by the engine, not by the app's view picker: another person
// reads a private view through the resource route neither in a list nor by its id.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let ownerTok: string;
let readerTok: string;
let adminTok: string;

const view = (_id: string, visibility: string, shared: { roles?: string[]; users?: string[] } = {}) => ({
  _id,
  view_name: _id,
  entity: "Customer",
  owner: "owner@d",
  visibility,
  shared_with_roles: shared.roles ?? null,
  shared_with_users: shared.users ?? null,
  filters: [["customer_name", "=", "Private Person"]],
  docstatus: 0,
});

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });
const listIds = async (tok: string) => {
  const res = await app.inject({ method: "GET", url: "/api/v1/resource/ListPreference?page_size=50", headers: bearer(tok) });
  expect(res.statusCode).toBe(200);
  return (res.json().data as Array<{ _id: string }>).map((row) => row._id).sort();
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  for (const row of [
    view("private", "private"),
    view("everyone", "everyone"),
    view("shared-role", "shared", { roles: ["Sales"] }),
    view("shared-user", "shared", { users: ["reader@d"] }),
    view("shared-elsewhere", "shared", { roles: ["Accounts"], users: ["third@d"] }),
    // A view set back to private keeps its old sharing lists; private still wins.
    view("private-once-shared", "private", { roles: ["Sales"], users: ["reader@d"] }),
  ]) {
    await db.insertOne("ListPreference", row, "core");
  }
  ownerTok = await ta.sign({ sub: "owner@d", email: "owner@d", roles: ["System User"], tiers: ["internal"] });
  readerTok = await ta.sign({ sub: "reader@d", email: "reader@d", roles: ["System User", "Sales"], tiers: ["internal"] });
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("the visibility of a saved view", () => {
  it("lists to another person only the views shared with them or with everyone", async () => {
    expect(await listIds(readerTok)).toEqual(["everyone", "shared-role", "shared-user"]);
  });

  it("refuses another person a private view read by its id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/resource/ListPreference/private", headers: bearer(readerTok) });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain("Private Person");
  });

  it("lists every view of its owner", async () => {
    expect(await listIds(ownerTok)).toHaveLength(6);
  });

  it("lists every view to an Administrator", async () => {
    expect(await listIds(adminTok)).toHaveLength(6);
  });
});
