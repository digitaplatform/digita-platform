import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Mirror resource-api.integration.test.ts's environment so the app boots the
// same way (no Redis, file translations, in-memory replica set). The body limit
// is the engine's default, 10mb.
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

import { randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { BaseDocument } from "../src/core/document/base-document.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import type { HookServices } from "../src/core/hooks/hook-runner.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let authToken: string;

// A signature the app's pad stores: a PNG data URL. 45 KiB of incompressible bytes
// encode to 60 KiB, the upper end of a drawn signature's PNG.
const signature = (): string => `data:image/png;base64,${randomBytes(45 * 1024).toString("base64")}`;

// A fixture entity with a Signature field and an action whose dialog asks for one;
// the action stores what its dialog sent, as an app's accept action does.
const PROBE: EntityDefinition = {
  name: "SignatureProbe",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "SP-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  fields: [
    { fieldname: "signature", fieldtype: "Signature", label: "Signature" },
  ],
  actions: [
    {
      action: "sign",
      label: "Sign",
      opens_dialog: true,
      dialog_fields: [{ fieldname: "signature", fieldtype: "Signature", label: "Signature" }],
    },
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

  // Same fixture technique as hook-error-4xx.integration.test.ts: the entity joins the
  // registry the resource routes use, and its action hook goes straight onto the hookRunner.
  result.registry.register(PROBE);
  await db.ensureCollection("SignatureProbe", "app");
  const probeHooks = new Map<string, unknown>();
  probeHooks.set("action:sign", (async (doc: BaseDocument, _ctx: unknown, services: HookServices) => {
    await (services.documentService as DocumentService).update(
      "SignatureProbe",
      doc._id,
      { signature: services.actionParams?.["signature"] },
      services.user,
      undefined,
      { sessionOverride: services.session },
    );
  }) as never);
  (result.hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> })
    .hooks.set("SignatureProbe", probeHooks as never);

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

async function storedSignature(name: string): Promise<unknown> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/resource/SignatureProbe/${name}`,
    headers: authHeaders(),
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.signature;
}

describe("a Signature field holds a drawn signature's PNG data URL whole", () => {
  it("saves, replaces and clears it through the resource API", async () => {
    const first = signature();
    expect(first.length).toBeGreaterThan(60 * 1024);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/resource/SignatureProbe",
      headers: authHeaders(),
      payload: { signature: first },
    });
    expect(created.statusCode).toBe(201);
    const name = created.json().data._id as string;
    expect(await storedSignature(name)).toBe(first);

    const second = signature();
    const replaced = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/SignatureProbe/${name}`,
      headers: authHeaders(),
      payload: { signature: second },
    });
    expect(replaced.statusCode).toBe(200);
    expect(await storedSignature(name)).toBe(second);

    // The record form sends a cleared field as null.
    const cleared = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/SignatureProbe/${name}`,
      headers: authHeaders(),
      payload: { signature: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(await storedSignature(name)).toBeNull();
  });

  it("carries it in an action's dialog payload to the action, which stores it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/resource/SignatureProbe",
      headers: authHeaders(),
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const name = created.json().data._id as string;

    const drawn = signature();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/resource/SignatureProbe/${name}/action/sign`,
      headers: authHeaders(),
      payload: { signature: drawn },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.dialog_data.signature).toBe(drawn);
    expect(await storedSignature(name)).toBe(drawn);
  });
});

describe("a Signature field refuses a value that is no drawn signature", () => {
  async function create(value: unknown) {
    return app.inject({
      method: "POST",
      url: "/api/v1/resource/SignatureProbe",
      headers: authHeaders(),
      payload: { signature: value },
    });
  }

  it.each([
    ["a remote URL", "https://example.com/signature.png"],
    ["a data URL of another image type", `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`],
    ["a PNG data URL whose payload is no base64", "data:image/png;base64,not base64!"],
    ["a PNG data URL whose base64 is cut short", "data:image/png;base64,iVBORw0KGgo"],
  ])("refuses %s with 400 naming the field", async (_case, value) => {
    const res = await create(value);
    expect(res.statusCode).toBe(400);
    expect(res.json().messages).toContainEqual(
      expect.objectContaining({ text: "signature has an invalid type", path: "signature" }),
    );
  });

  it("refuses a PNG data URL over 1 MiB with 400 naming the field and the bound", async () => {
    const oversized = `data:image/png;base64,${randomBytes(800 * 1024).toString("base64")}`;
    expect(oversized.length).toBeGreaterThan(1024 * 1024);
    const res = await create(oversized);
    expect(res.statusCode).toBe(400);
    expect(res.json().messages).toContainEqual(
      expect.objectContaining({ text: `signature cannot exceed ${1024 * 1024} characters`, path: "signature" }),
    );
  });

  it("refuses the same values on an update", async () => {
    const created = await create(signature());
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/SignatureProbe/${created.json().data._id as string}`,
      headers: authHeaders(),
      payload: { signature: "https://example.com/signature.png" },
    });
    expect(res.statusCode).toBe(400);
  });
});
