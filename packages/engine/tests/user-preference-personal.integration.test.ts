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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// A person's preferences are theirs alone: a look, a mode or a density another person picked is
// never read or changed through someone else's session, an Administrator's included.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let clerkTok: string;
let adminTok: string;

const RES = "/api/v1/resource/UserPreference";
const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  await db.insertOne("UserPreference", { _id: "clerk-density", owner: "clerk@d", pref_key: "ui.density", value: "compact", docstatus: 0 }, "core");
  await db.insertOne("UserPreference", { _id: "admin-density", owner: "admin@d", pref_key: "ui.density", value: "comfortable", docstatus: 0 }, "core");
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["System User"], tiers: ["internal"] });
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a UserPreference row", () => {
  it("lists to an Administrator only their own rows", async () => {
    const res = await app.inject({ method: "GET", url: `${RES}?page_size=50`, headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["admin-density"]);
  });

  it("refuses an Administrator another person's row by its id, for a read, a change and a delete", async () => {
    const url = `${RES}/clerk-density`;
    const read = await app.inject({ method: "GET", url, headers: bearer(adminTok) });
    expect([403, 404]).toContain(read.statusCode);
    expect(read.body).not.toContain("compact");
    const changed = await app.inject({ method: "PUT", url, headers: bearer(adminTok), payload: { value: "spacious" } });
    expect([403, 404]).toContain(changed.statusCode);
    const deleted = await app.inject({ method: "DELETE", url, headers: bearer(adminTok) });
    expect([403, 404]).toContain(deleted.statusCode);
    const kept = (await db.findOne("UserPreference", "clerk-density", "core")) as Record<string, unknown>;
    expect(kept["value"]).toBe("compact");
  });

  it("lets every person read, change and create their own rows", async () => {
    const own = await app.inject({ method: "GET", url: `${RES}?page_size=50`, headers: bearer(clerkTok) });
    expect((own.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["clerk-density"]);
    const changed = await app.inject({ method: "PUT", url: `${RES}/admin-density`, headers: bearer(adminTok), payload: { value: "compact" } });
    expect(changed.statusCode).toBe(200);
    const created = await app.inject({ method: "POST", url: RES, headers: bearer(adminTok), payload: { pref_key: "ui.mode", value: "dark" } });
    expect(created.statusCode).toBe(201);
  });
});
