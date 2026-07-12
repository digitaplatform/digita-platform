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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let sign: (c: {
  sub: string;
  email: string;
  roles: string[];
  tiers?: string[];
}) => Promise<string>;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  sign = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("Boot API Integration", () => {
  describe("GET /api/v1/boot", () => {
    it("returns boot data without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      // Anonymous: no grants; only the open `anonymous` tier is enterable.
      expect(body.data.audience.grants).toEqual([]);
      expect(body.data.audience.can_enter.anonymous).toBe(true);
      expect(body.data.audience.can_enter.internal).toBe(false);
      expect(body.data.audience.can_enter.external).toBe(false);
    });

    it("returns user info with auth", async () => {
      const access_token = await sign({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.user).toBeDefined();
      expect(body.data.user.email).toBe("admin@digita.local");
    });

    it("surfaces the token's `tiers` audience-set and the canEnter verdict (ADR-A1)", async () => {
      const access_token = await sign({
        sub: "dual@digita.local",
        email: "dual@digita.local",
        roles: ["Administrator"],
        tiers: ["internal", "external"],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.user.tiers).toEqual(["internal", "external"]);
      expect(body.data.audience.grants).toEqual(["internal", "external"]);
      expect(body.data.audience.can_enter.internal).toBe(true);
      expect(body.data.audience.can_enter.external).toBe(true);
      expect(body.data.audience.can_enter.anonymous).toBe(true);
    });

    it("reports no grants for a token with an empty tier-set (boot does not fabricate a set)", async () => {
      const access_token = await sign({
        sub: "legacy@digita.local",
        email: "legacy@digita.local",
        roles: ["System User"],
        tiers: [],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      const body = res.json();
      // Empty/absent set ⇒ [] grants surfaced; /boot never fabricates a tier.
      // (Enforcement — no token issued without a tier — is on the auth side.)
      expect(body.data.audience.grants).toEqual([]);
      expect(body.data.audience.can_enter.internal).toBe(false);
    });

    it("filters malformed/unknown tier values (never 500s)", async () => {
      const access_token = await sign({
        sub: "garbage@digita.local",
        email: "garbage@digita.local",
        roles: ["System User"],
        tiers: ["internal", "bogus", "internal"],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Unknown values dropped, duplicates deduped.
      expect(body.data.audience.grants).toEqual(["internal"]);
    });
  });

  describe("GET /health", () => {
    it("returns health status", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe("ok");
      expect(body.data.version).toBeDefined();
    });
  });

  describe("GET /api/v1/meta", () => {
    it("returns entity list with auth", async () => {
      const access_token = await sign({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/meta",
        headers: { authorization: `Bearer ${access_token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });
});
