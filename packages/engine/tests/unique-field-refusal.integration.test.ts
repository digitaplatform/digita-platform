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

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { IndexManager } from "../src/core/database/index-manager.js";

let replSet: ReplicaFixture;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;

/** An entity with a unique code, as Language has one; the start builds its unique index. */
const PRODUCT: EntityDefinition = {
  name: "UniqueProduct",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "UP-", pad_length: 4 },
  is_submittable: false,
  track_changes: false,
  fields: [
    { fieldname: "code", fieldtype: "Data", label: "Product code", unique: true },
    { fieldname: "title", fieldtype: "Data", label: "Title" },
  ],
  permissions: [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }],
} as unknown as EntityDefinition;

const headers = () => ({ authorization: `Bearer ${adminTok}` });
const create = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/v1/resource/UniqueProduct", headers: headers(), payload });

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(PRODUCT);
  await db.ensureCollection("UniqueProduct", "app");
  await new IndexManager(db).ensureIndexes(PRODUCT);
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a value a unique field already holds", () => {
  /** What the person reads: the status, the error code, the field the message binds to, and its text. */
  const answer = (res: { statusCode: number; body: string; json: () => { error: { code: string; field?: string }; messages: Array<{ text: string; path?: string }> } }) => ({
    status: res.statusCode,
    code: res.json().error.code,
    field: res.json().error.field,
    message: res.json().messages[0],
    showsDriverText: /E11000|dup key|idx_uniq/.test(res.body),
  });
  const refused = { status: 409, code: "DUPLICATE_KEY", field: "code", message: { text: "A record with this code already exists", path: "code" }, showsDriverText: false };

  it("refuses an insert by the field, in the person's language, without the database's text", async () => {
    expect((await create({ code: "A-1", title: "First" })).statusCode).toBe(201);
    expect(answer(await create({ code: "A-1", title: "Second" }))).toMatchObject(refused);
  });

  it("refuses an update the same way, and keeps the record as it was", async () => {
    const other = await create({ code: "B-1", title: "Other" });
    const id = other.json().data._id as string;
    const res = await app.inject({ method: "PUT", url: `/api/v1/resource/UniqueProduct/${id}`, headers: headers(), payload: { code: "A-1" } });
    expect(answer(res)).toMatchObject(refused);
    expect((await db.findOne("UniqueProduct", id, "app"))?.["code"]).toBe("B-1");
  });

  it("PLANTED INNOCENT: stores a value no other record holds", async () => {
    expect((await create({ code: "C-1", title: "Third" })).statusCode).toBe(201);
  });
});
