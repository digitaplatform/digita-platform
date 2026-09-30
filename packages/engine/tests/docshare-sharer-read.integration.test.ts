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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// File grants System User read only `if_owner`, so a System User who does not own a File
// cannot read it. A DocShare must not hand that user the read that RBAC denies.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;
let strangerTok: string;
let fileId: string;
let sign: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  sign = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();

  adminTok = await sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  strangerTok = await sign({ sub: "stranger@d", email: "stranger@d", roles: ["System User"] });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/resource/File",
    headers: bearer(adminTok),
    payload: { file_name: "payroll.pdf", file_url: "/uploads/payroll.pdf", file_size: 1, file_type: "application/pdf" },
  });
  expect(created.statusCode).toBe(201);
  fileId = created.json().data._id as string;
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a DocShare grants only what the sharer may read", () => {
  it("denies the stranger a direct read of the admin's File", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}`, headers: bearer(strangerTok) });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a DocShare the stranger creates for a File it may not read, and the File stays closed", async () => {
    const share = await app.inject({
      method: "POST",
      url: "/api/v1/resource/DocShare",
      headers: bearer(strangerTok),
      payload: { entity: "File", document_name: fileId, shared_with: "stranger@d", can_read: true, notify: false },
    });
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}`, headers: bearer(strangerTok) });
    expect({ share: share.statusCode, read: read.statusCode }).toEqual({ share: 403, read: 403 });
  });

  it("lets a sharer who may read the File share it, and the share grants read", async () => {
    const share = await app.inject({
      method: "POST",
      url: "/api/v1/resource/DocShare",
      headers: bearer(adminTok),
      payload: { entity: "File", document_name: fileId, shared_with: "carol@d", can_read: true, notify: false },
    });
    expect(share.statusCode).toBe(201);

    const carolTok = await sign({ sub: "carol@d", email: "carol@d", roles: ["System User"] });
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}`, headers: bearer(carolTok) });
    expect(read.statusCode).toBe(200);
  });

  it("refuses a DocShare of a document that does not exist", async () => {
    const share = await app.inject({
      method: "POST",
      url: "/api/v1/resource/DocShare",
      headers: bearer(adminTok),
      payload: { entity: "File", document_name: "NO-SUCH-FILE", shared_with: "carol@d", can_read: true, notify: false },
    });
    expect(share.statusCode).toBe(404);
  });
});

// A reader through RBAC may share a document; a reader only through a share may share it on
// only when that share has can_share.
describe("a share reader shares on only with can_share", () => {
  const shareAs = (tok: string, sharedWith: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1/resource/DocShare",
      headers: bearer(tok),
      payload: { entity: "File", document_name: fileId, shared_with: sharedWith, can_read: true, notify: false, ...extra },
    });
  const readAs = async (email: string) => {
    const tok = await sign({ sub: email, email, roles: ["System User"] });
    return app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}`, headers: bearer(tok) });
  };

  it("refuses the share of a reader whose share lacks can_share, and the File stays closed", async () => {
    expect((await shareAs(adminTok, "carol2@d", { can_share: false })).statusCode).toBe(201);
    const carolTok = await sign({ sub: "carol2@d", email: "carol2@d", roles: ["System User"] });
    expect((await readAs("carol2@d")).statusCode).toBe(200);

    const share = await shareAs(carolTok, "dave@d");
    const read = await readAs("dave@d");
    expect({ share: share.statusCode, read: read.statusCode }).toEqual({ share: 403, read: 403 });
  });

  it("writes the share of a reader whose share has can_share, and it grants read", async () => {
    expect((await shareAs(adminTok, "erin@d", { can_share: true })).statusCode).toBe(201);
    const erinTok = await sign({ sub: "erin@d", email: "erin@d", roles: ["System User"] });

    const share = await shareAs(erinTok, "frank@d");
    const read = await readAs("frank@d");
    expect({ share: share.statusCode, read: read.statusCode }).toEqual({ share: 201, read: 200 });
  });

  it("refuses the share of a reader whose share with can_share has expired", async () => {
    expect((await shareAs(adminTok, "gina@d", { can_share: true, expires_at: "2020-01-01T00:00:00.000Z" })).statusCode).toBe(201);
    const ginaTok = await sign({ sub: "gina@d", email: "gina@d", roles: ["System User"] });

    expect((await shareAs(ginaTok, "hank@d")).statusCode).toBe(403);
  });
});
