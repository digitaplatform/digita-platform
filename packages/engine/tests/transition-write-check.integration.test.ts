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

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
const tokens: Record<string, string> = {};

// An entity with a `status` field and no workflow: no state or transition declares who may
// move it, so a move through the transition route is a write of that field like any other.
const PROBE: EntityDefinition = {
  name: "StatusProbe",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "ST-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "published"] },
  ],
  permissions: [
    { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Editor", level: 0, select: 1, read: 1, write: 1 },
    { role: "Viewer", level: 0, select: 1, read: 1 },
  ],
} as unknown as EntityDefinition;

// The same field under a workflow: only Editor may move draft → published.
const WORKFLOW_PROBE: EntityDefinition = {
  ...PROBE,
  name: "WorkflowProbe",
  naming: { strategy: "auto_increment", prefix: "WF-", pad_length: 4 },
  states: [
    { value: "draft", label: "Draft", is_initial: true, doc_status: 0 },
    { value: "published", label: "Published", doc_status: 0 },
  ],
  transitions: [{ from: "draft", to: "published", label: "Publish", allowed_roles: ["Editor"] }],
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
  result.registry.register(PROBE);
  await db.ensureCollection("StatusProbe", "app");
  result.registry.register(WORKFLOW_PROBE);
  await db.ensureCollection("WorkflowProbe", "app");

  for (const [who, roles] of Object.entries({
    admin: ["Administrator", "System User"],
    editor: ["Editor"],
    viewer: ["Viewer"],
    stranger: ["other:Clerk"],
  })) {
    tokens[who] = await ta.sign({ sub: `${who}@digita.local`, email: `${who}@digita.local`, roles });
  }
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

async function createDraft(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/resource/StatusProbe",
    headers: { authorization: `Bearer ${tokens["admin"]}` },
    payload: { title: "Page", status: "draft" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data._id as string;
}

async function transition(who: string, name: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/resource/StatusProbe/${name}/transition`,
    headers: { authorization: `Bearer ${tokens[who]}` },
    payload: { to: "published" },
  });
}

async function storedStatus(name: string): Promise<unknown> {
  return (await db.findOne("StatusProbe", name, "app"))?.["status"];
}

describe("a transition of an entity without a workflow", () => {
  it.each(["viewer", "stranger"])("is refused to a %s who may not write, and the status stays", async (who) => {
    const name = await createDraft();
    expect((await transition(who, name)).statusCode).toBe(403);
    expect(await storedStatus(name)).toBe("draft");
  });

  it("moves the status for a user who may write", async () => {
    const name = await createDraft();
    expect((await transition("editor", name)).statusCode).toBe(200);
    expect(await storedStatus(name)).toBe("published");
  });
});

describe("a transition of an entity with a workflow", () => {
  async function createWorkflowDraft(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/WorkflowProbe",
      headers: { authorization: `Bearer ${tokens["admin"]}` },
      payload: { title: "Page" },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data._id as string;
  }

  // The workflow judges only a target that names another state, so no other body may write.
  it.each([
    ["no state", null],
    ["the state it is in", "draft"],
    ["nothing", undefined],
  ])("refuses a move to %s, and the record stays as it was", async (_case, to) => {
    const name = await createWorkflowDraft();
    const before = await db.findOne("WorkflowProbe", name, "app");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/resource/WorkflowProbe/${name}/transition`,
      headers: { authorization: `Bearer ${tokens["stranger"]}` },
      payload: to === undefined ? {} : { to },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    const after = await db.findOne("WorkflowProbe", name, "app");
    expect(after?.["status"]).toBe("draft");
    expect(after?.["modified_by"]).toBe(before?.["modified_by"]);
  });

  it("moves a declared transition for a role it allows", async () => {
    const name = await createWorkflowDraft();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/resource/WorkflowProbe/${name}/transition`,
      headers: { authorization: `Bearer ${tokens["editor"]}` },
      payload: { to: "published" },
    });
    expect(res.statusCode).toBe(200);
    expect((await db.findOne("WorkflowProbe", name, "app"))?.["status"]).toBe("published");
  });
});
