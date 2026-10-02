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

// A workflow whose state field a writer may send, and whose rows each role reads by a
// different rule: Owner its own rows, Reader the rows not titled "Hidden", Editor all rows.
// Every row also names the roles that may see it, as Workspace does.
const FLOW: EntityDefinition = {
  name: "GuardedFlow",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "GF-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  role_visibility_field: "visible_to",
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "published"] },
    { fieldname: "visible_to", fieldtype: "JSON", label: "Visible to" },
  ],
  permissions: [
    { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Owner", level: 0, select: 1, read: 1, write: 1, create: 1, if_owner: 1 },
    { role: "Reader", level: 0, select: 1, read: 1, condition: "doc.title != 'Hidden'" },
    { role: "Editor", level: 0, select: 1, read: 1, write: 1, create: 1 },
  ],
  states: [
    { value: "draft", label: "Draft", is_initial: true, doc_status: 0 },
    { value: "published", label: "Published", doc_status: 0 },
  ],
  transitions: [
    { from: "draft", to: "published", label: "Publish", allowed_roles: ["Owner", "Reader", "Editor"] },
  ],
} as unknown as EntityDefinition;

// The same state field without a workflow: moving it is a plain write.
const PLAIN: EntityDefinition = {
  name: "PlainStatus",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "PS-", pad_length: 4 },
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
    { role: "Reader", level: 0, select: 1, read: 1 },
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
  result.registry.register(FLOW);
  await db.ensureCollection("GuardedFlow", "app");
  result.registry.register(PLAIN);
  await db.ensureCollection("PlainStatus", "app");

  for (const [who, roles] of Object.entries({
    admin: ["Administrator", "System User"],
    owner: ["Owner"],
    reader: ["Reader"],
    editor: ["Editor"],
  })) {
    tokens[who] = await ta.sign({ sub: `${who}@digita.local`, email: `${who}@digita.local`, roles });
  }
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

async function call(method: "GET" | "PUT" | "POST", who: string, url: string, payload?: unknown) {
  return app.inject({
    method,
    url: `/api/v1/resource/${url}`,
    headers: { authorization: `Bearer ${tokens[who]}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function create(entity: string, who: string, data: Record<string, unknown>): Promise<string> {
  const res = await call("POST", who, entity, data);
  expect(res.statusCode).toBe(201);
  return res.json().data._id as string;
}

async function stored(entity: string, name: string): Promise<Record<string, unknown> | null> {
  return (await db.findOne(entity, name, "app")) as Record<string, unknown> | null;
}

describe("a transition of a row the caller may not read", () => {
  it.each([
    ["an owner rule", "owner", "admin", { title: "Theirs" }],
    ["a condition", "reader", "admin", { title: "Hidden" }],
    ["role visibility", "owner", "owner", { title: "Mine", visible_to: ["Elsewhere"] }],
  ])("is answered as a read when %s hides the row, and the state stays", async (_case, who, creator, data) => {
    const name = await create("GuardedFlow", creator, data);
    const read = await call("GET", who, `GuardedFlow/${name}`);
    expect(read.statusCode).toBeGreaterThanOrEqual(403);
    expect(read.statusCode).toBeLessThan(500);

    const res = await call("POST", who, `GuardedFlow/${name}/transition`, { to: "published" });
    expect(res.statusCode).toBe(read.statusCode);
    expect(res.json().error?.code).toBe(read.json().error?.code);
    expect((await stored("GuardedFlow", name))?.["status"]).toBe("draft");
  });

  it.each([
    ["the owner of the row", "owner", "owner", { title: "Mine" }],
    ["a reader whose condition admits the row", "reader", "admin", { title: "Open" }],
  ])("moves for %s", async (_case, who, creator, data) => {
    const name = await create("GuardedFlow", creator, data);
    expect((await call("POST", who, `GuardedFlow/${name}/transition`, { to: "published" })).statusCode).toBe(200);
    expect((await stored("GuardedFlow", name))?.["status"]).toBe("published");
  });
});

describe("an update of the workflow field", () => {
  it.each([
    ["no state", null],
    ["an empty state", ""],
    ["an object", { toString: 1 }],
    ["an undeclared state", "archived"],
  ])("refuses %s as an undeclared transition, and the state stays", async (_case, status) => {
    const name = await create("GuardedFlow", "admin", { title: "Page" });
    const res = await call("PUT", "editor", `GuardedFlow/${name}`, { status });
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code).toBe("ILLEGAL_TRANSITION");
    expect((await stored("GuardedFlow", name))?.["status"]).toBe("draft");
  });

  it("saves other fields with the state the row is in", async () => {
    const name = await create("GuardedFlow", "admin", { title: "Page" });
    expect((await call("PUT", "editor", `GuardedFlow/${name}`, { title: "New", status: "draft" })).statusCode).toBe(200);
    const row = await stored("GuardedFlow", name);
    expect(row?.["title"]).toBe("New");
    expect(row?.["status"]).toBe("draft");
  });

  it("moves along a declared transition", async () => {
    const name = await create("GuardedFlow", "admin", { title: "Page" });
    expect((await call("PUT", "editor", `GuardedFlow/${name}`, { status: "published" })).statusCode).toBe(200);
    expect((await stored("GuardedFlow", name))?.["status"]).toBe("published");
  });
});

describe("a transition to a target that is not a state name", () => {
  it.each([
    ["an object", "GuardedFlow", { toString: 1 }],
    ["an array", "GuardedFlow", ["published"]],
    ["a number", "GuardedFlow", 7],
    ["an object", "PlainStatus", { toString: 1 }],
  ])("refuses %s on %s as an undeclared transition, and the state stays", async (_case, entity, to) => {
    const name = await create(entity, "admin", { title: "Page", status: "draft" });
    const res = await call("POST", "editor", `${entity}/${name}/transition`, { to });
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code).toBe("ILLEGAL_TRANSITION");
    expect((await stored(entity, name))?.["status"]).toBe("draft");
  });
});

describe("a transition to no state of an entity without a workflow", () => {
  it("is refused by the write check to a caller who may not write, without the record's state", async () => {
    const name = await create("PlainStatus", "admin", { title: "Page", status: "draft" });
    const res = await call("POST", "reader", `PlainStatus/${name}/transition`, { to: null });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("draft");
    expect((await stored("PlainStatus", name))?.["status"]).toBe("draft");
  });

  it("is refused to a caller who may write, as a move to no state", async () => {
    const name = await create("PlainStatus", "admin", { title: "Page", status: "draft" });
    const res = await call("POST", "editor", `PlainStatus/${name}/transition`, { to: null });
    expect(res.statusCode).toBe(409);
    expect((await stored("PlainStatus", name))?.["status"]).toBe("draft");
  });

  it("still moves the status for a caller who may write", async () => {
    const name = await create("PlainStatus", "admin", { title: "Page", status: "draft" });
    expect((await call("POST", "editor", `PlainStatus/${name}/transition`, { to: "published" })).statusCode).toBe(200);
    expect((await stored("PlainStatus", name))?.["status"]).toBe("published");
  });
});
