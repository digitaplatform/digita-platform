import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", async () => {
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const uploadDir = join(tmpdir(), `digita-perm-retired-${process.pid}-${Math.random().toString(36).slice(2)}`);
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
    UPLOAD_MAX_SIZE: "1mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: uploadDir,
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: true, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false, PERMISSION_SCOPE_ENABLED: true,
  } };
});
const warn = vi.hoisted(() => vi.fn());
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
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
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { SchemaMigrator } from "../src/core/database/schema-migrator.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { buildTestAuth } from "./_test-auth.js";

// A tenant database from before #77: the engine defined a `Permission` entity in the identity
// database, and boot stored its definition in the `Entity` meta-collection, a naming sequence and
// the rows an Administrator created.
const OLD_PERMISSION_DEFINITION = {
  _id: "Permission",
  name: "Permission",
  module: "core",
  database: "identity",
  label: "Permission",
  naming: { strategy: "auto_increment", prefix: "PERM-", pad_length: 5 },
  fields: [
    { fieldname: "user", fieldtype: "Data", label: "User", required: true },
    { fieldname: "allow_entity", fieldtype: "Data", label: "Allow Entity", required: true },
    { fieldname: "allow_field", fieldtype: "Data", label: "Allow Field", required: true },
    { fieldname: "allow_value", fieldtype: "Data", label: "Allow Value", required: true },
  ],
  permissions: [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }],
};
const OLD_ROW = {
  _id: "PERM-00001",
  user: "sys@test",
  allow_entity: "File",
  allow_field: "file_name",
  allow_value: "x.pdf",
  is_default: false,
  owner: "admin@digita.local",
  modified_by: "admin@digita.local",
  creation: new Date(),
  modified: new Date(),
};

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: EntityRegistry;
let token: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const seeder = new MongoDBService();
  await seeder.connect();
  await seeder.insertOne(DIGITA.COLLECTIONS.ENTITY, OLD_PERMISSION_DEFINITION, DIGITA.DATABASES.CORE);
  await seeder.insertOne("Permission", OLD_ROW, DIGITA.DATABASES.IDENTITY);
  await seeder.insertOne("_sequences", { _id: "Permission", naming_seq: 1 }, DIGITA.DATABASES.IDENTITY);
  await seeder.disconnect();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry;
  await result.startup();
  await app.ready();
  token = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("boot on a database that holds the retired Permission entity (#77)", () => {
  it("answers not found for the entity, its definition and its rows", async () => {
    const headers = { authorization: `Bearer ${token}` };
    for (const url of ["/api/v1/resource/Permission", "/api/v1/resource/Permission/PERM-00001", "/api/v1/meta/Permission"]) {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode, url).toBe(404);
    }
    expect(registry.has("Permission")).toBe(false);
  });

  it("removes the stored rows, the naming sequence and the stored definition", async () => {
    expect(await db.listCollections(DIGITA.DATABASES.IDENTITY)).not.toContain("Permission");
    expect(await db.findOne("_sequences", "Permission", DIGITA.DATABASES.IDENTITY)).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.ENTITY, "Permission", DIGITA.DATABASES.CORE)).toBeNull();
  });

  it("lists the dropped rows in its output first, so an owner can move them to a role's scope", () => {
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "Permission", rows: [expect.objectContaining({ _id: "PERM-00001", allow_value: "x.pdf" })] }),
      expect.any(String),
    );
  });

  it("is a no-op on a second run", async () => {
    warn.mockClear();
    await new SchemaMigrator(db).migrateAll(registry.getAll());
    expect(await db.listCollections(DIGITA.DATABASES.IDENTITY)).not.toContain("Permission");
    expect(warn).not.toHaveBeenCalledWith(expect.objectContaining({ entity: "Permission" }), expect.any(String));
  });
});
