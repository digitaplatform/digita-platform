import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Mirror resource-api.integration.test.ts's environment so the app boots the
// same way (no Redis, file translations, in-memory replica set).
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
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// Every write route answers with the document it wrote. A clerk who reads and
// writes level 0 only must get back what getDoc shows them: no level-1 field,
// whether an Administrator stored it or a default filled it, and no title of a
// level-1 Link.
let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let adminToken: string;
let clerkToken: string;

const clerkLevel0 = { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 0, submit: 1, cancel: 1, amend: 1 };
const adminLevel0 = { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 };

const CUSTOMER = {
  name: "WaCustomer",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "company_name",
  fields: [{ fieldname: "company_name", fieldtype: "Data", label: "Company" }],
  permissions: [adminLevel0, clerkLevel0],
} as unknown as EntityDefinition;

const ORDER = {
  name: "WaOrder",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "WA-", pad_length: 4 },
  is_submittable: true,
  workflow_field: "status",
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
    { fieldname: "note", fieldtype: "Data", label: "Note" },
    { fieldname: "secret", fieldtype: "Data", label: "Secret", perm_level: 1, default: "default-secret" },
    { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "WaCustomer", perm_level: 1 },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "confirmed", "delivered", "cancelled"], default: "draft" },
  ],
  states: [
    { value: "draft", doc_status: 0, is_initial: true },
    { value: "confirmed", doc_status: 1, docstatus_default: true },
    { value: "delivered", doc_status: 1 },
    { value: "cancelled", doc_status: 2, is_terminal: true },
  ],
  transitions: [{ from: "confirmed", to: "delivered", action: "deliver", allowed_roles: [] }],
  permissions: [adminLevel0, clerkLevel0],
} as unknown as EntityDefinition;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  result.registry.register(CUSTOMER);
  result.registry.register(ORDER);
  await db.ensureCollection("WaCustomer", "app");
  await db.ensureCollection("WaOrder", "app");
  adminToken = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] });
  clerkToken = await ta.sign({ sub: "clerk@digita.local", email: "clerk@digita.local", roles: ["Clerk"] });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function write(token: string, method: "POST" | "PUT", url: string, payload: Record<string, unknown> = {}) {
  const res = await app.inject({ method, url: `/api/v1/resource/${url}`, headers: as(token), payload });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
  return res.json().data as Record<string, unknown>;
}

function expectMasked(answer: Record<string, unknown>) {
  expect(answer).not.toHaveProperty("secret");
  expect(answer).not.toHaveProperty("customer");
  expect((answer["_link_titles"] as Record<string, string> | undefined)?.["customer"]).toBeUndefined();
}

describe("Every write answers a caller with only the fields the caller may read", () => {
  let orderId: string;

  it("answers an Administrator with every field and the title of every Link", async () => {
    await write(adminToken, "POST", "WaCustomer", { _id: "C-1", company_name: "Acme GmbH" });
    const created = await write(adminToken, "POST", "WaOrder", { title: "Order", secret: "s3cret", customer: "C-1" });
    expect(created["secret"]).toBe("s3cret");
    expect((created["_link_titles"] as Record<string, string>)["customer"]).toBe("Acme GmbH");
    orderId = String(created["_id"]);
  });

  it("masks the answer to update, preview and create", async () => {
    const updated = await write(clerkToken, "PUT", `WaOrder/${orderId}`, { title: "Order", note: "by the clerk" });
    expect(updated["note"]).toBe("by the clerk");
    expectMasked(updated);
    expectMasked(await write(clerkToken, "POST", "WaOrder/preview", { title: "Preview" }));
    expectMasked(await write(clerkToken, "POST", "WaOrder", { title: "Clerk's order" }));
  });

  it("masks the answer to copy, submit, transition, cancel and amend", async () => {
    expectMasked(await write(clerkToken, "POST", `WaOrder/${orderId}/copy`));
    expectMasked(await write(clerkToken, "POST", `WaOrder/${orderId}/submit`));
    expectMasked(await write(clerkToken, "POST", `WaOrder/${orderId}/transition`, { to: "delivered" }));
    expectMasked(await write(clerkToken, "POST", `WaOrder/${orderId}/cancel`));
    expectMasked(await write(clerkToken, "POST", `WaOrder/${orderId}/amend`));
    // The writes kept the stored values: the mask is on the answer only.
    const stored = await db.findOne("WaOrder", orderId, "app");
    expect(stored?.["secret"]).toBe("s3cret");
    expect(stored?.["customer"]).toBe("C-1");
  });
});
