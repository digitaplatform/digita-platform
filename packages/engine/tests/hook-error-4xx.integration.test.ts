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
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { HookRunner } from "../src/core/hooks/hook-runner.js";
import type { BaseDocument } from "../src/core/document/base-document.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let authToken: string;

// A fixture entity whose `validate` hook rejects based on the posted `mode`
// field — one path DECLARES a 4xx (business-rule convention), the other throws
// a plain Error (a genuine server fault). No ERP concepts: this is a generic
// probe, keeping the engine 100% app-agnostic.
const PROBE: EntityDefinition = {
  name: "HookProbe",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "HP-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  fields: [
    { fieldname: "mode", fieldtype: "Data", label: "Mode" },
  ],
  permissions: [
    { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
  ],
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

  // Register the fixture entity into the SAME registry the resource routes use,
  // create its collection, and inject the validate hook directly onto the
  // hookRunner (same internal-map technique as hook-lifecycle.test.ts — the
  // hookRunner is exposed from createApp for exactly this test-fixture use).
  result.registry.register(PROBE);
  await db.ensureCollection("HookProbe", "app");

  const probeHooks = new Map<string, unknown>();
  probeHooks.set("validate", (async (doc: BaseDocument) => {
    const mode = doc.get("mode");
    if (mode === "declared422") {
      // The business-rule convention: attach an explicit 4xx statusCode so the
      // reason surfaces to the client as a typed 422 instead of a generic 500.
      throw Object.assign(new Error("over_delivery_not_allowed"), { statusCode: 422 });
    }
    if (mode === "plain") {
      // A genuine, undeclared server fault — must still become a generic 500.
      throw new Error("unexpected boom");
    }
  }) as never);
  (result.hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> })
    .hooks.set("HookProbe", probeHooks as never);

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

describe("D2 — business-rule hook errors surface as typed 4xx (HTTP)", () => {
  it("a validate hook that DECLARES statusCode 422 → POST returns 422 carrying the reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/HookProbe",
      headers: authHeaders(),
      payload: { mode: "declared422" },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.status_code).toBe(422);
    expect(body.error.code).toBe("BUSINESS_RULE_VIOLATION");
    // The reason reaches the client — swallowed no more. `error.detail` is never
    // run through server-side i18n, so it carries the raw reason verbatim.
    expect(body.error.detail).toBe("over_delivery_not_allowed");
    expect(body.messages[0].text).toBe("over_delivery_not_allowed");
  });

  it("a validate hook throwing a PLAIN Error (no statusCode) → POST returns a generic 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/HookProbe",
      headers: authHeaders(),
      payload: { mode: "plain" },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    // The internal reason must NOT leak on a genuine server fault.
    expect(body.error.detail).toBe("An unexpected error occurred");
    expect(body.error.detail).not.toContain("boom");
  });

  it("the same hook lets a clean payload through (201) — it only rejects the guarded modes", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/HookProbe",
      headers: authHeaders(),
      payload: { mode: "ok" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);
  });
});
