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
    PASSWORD_FIELD_KEYS: "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", PASSWORD_FIELD_ACTIVE_KEY_ID: "k1",
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
import type { EntityDefinition } from "@digitaplatform/shared";

// A Password field is written, never read back: getDoc hides its stored value
// (field-types.ts passwordHandler.fromStorage). Every other path that returns a
// stored row to a person must hide it the same way.
const vault = {
  name: "Vault",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "V-", pad_length: 4 },
  is_submittable: false,
  track_changes: true,
  title_field: "title",
  search_fields: ["title"],
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
    { fieldname: "secret", fieldtype: "Password", label: "Secret", idx: 2 },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
  ],
} as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let authToken: string;
let vaultId: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  result.registry.register(vault);
  await db.ensureCollection("Vault", "app");

  authToken = await ta.sign({
    sub: "admin@digita.local",
    email: "admin@digita.local",
    roles: ["Administrator", "System User"],
  });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

function authHeaders() {
  return { authorization: `Bearer ${authToken}` };
}

describe("a stored Password value never leaves the engine", () => {
  it("the create response omits it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/Vault",
      headers: authHeaders(),
      payload: { title: "Mail server", secret: "hunter2-first" },
    });
    expect(res.statusCode).toBe(201);
    vaultId = res.json().data._id;
    expect(res.json().data.secret).toBeUndefined();
  });

  it("getDoc omits it", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/Vault/${vaultId}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe("Mail server");
    expect(res.json().data.secret).toBeUndefined();
  });

  it("the list omits it in every row", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/resource/Vault", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].title).toBe("Mail server");
    expect(res.json().data[0].secret).toBeUndefined();
  });

  it("the list omits it when the caller names it in fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/Vault?fields=${encodeURIComponent(JSON.stringify(["_id", "secret"]))}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]._id).toBe(vaultId);
    expect(res.json().data[0].secret).toBeUndefined();
  });

  it("the update response omits it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/Vault/${vaultId}`,
      headers: authHeaders(),
      payload: { secret: "hunter2-second" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.secret).toBeUndefined();
  });

  it("the version history omits its old and new value", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/Vault/${vaultId}/versions`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("hunter2");
  });

  it("the audit log omits its old and new value", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/audit?entity=Vault", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].changes.map((c: { field: string }) => c.field)).toContain("secret");
    expect(res.body).not.toContain("hunter2");
  });

  it("the audit log still answers for an entity that is no longer registered", async () => {
    await db.insertOne("_versions", {
      _id: "gone-1", entity: "GoneEntity", document_name: "G-0001", changed_by: "admin@digita.local",
      timestamp: new Date(), changes: [{ field: "title", old: "a", new: "b" }],
    }, "audits");
    const res = await app.inject({ method: "GET", url: "/api/v1/audit?entity=GoneEntity", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].changes).toEqual([{ field: "title", old: "a", new: "b" }]);
  });

  it("the link search omits it when the picker asks for it as a column", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search/Vault?q=Mail&fields=title,secret", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].fields.title).toBe("Mail server");
    expect(res.body).not.toContain("hunter2");
  });

  it("the export omits it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/export/Vault?format=json", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Mail server");
    expect(res.body).not.toContain("hunter2");
  });
});
