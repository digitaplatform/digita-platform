import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Engine-only env (no APP_DIRS): the test registers its own entities.
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

let replSet: ReplicaFixture;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;
let clerkTok: string;
let orderId: string;
let signToken: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

/** A change-tracked order whose line cost only level 1 reads; the Clerk reads level 0 alone. */
const ORDER: EntityDefinition = {
  name: "VersionChildMaskOrder",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "VCM-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: true,
  track_views: false,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    {
      fieldname: "lines",
      fieldtype: "Table",
      label: "Lines",
      child_fields: [
        { fieldname: "item", fieldtype: "Data", label: "Item" },
        { fieldname: "cost", fieldtype: "Int", label: "Cost", perm_level: 1 },
      ],
    },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Administrator", level: 1, read: 1, write: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1 },
    { role: "Field Reader", level: 1, read: 1, fields: ["lines"] },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

type Change = { field: string; old: unknown; new: unknown };

async function changes(tok: string): Promise<Change[]> {
  const res = await app.inject({ method: "GET", url: `/api/v1/resource/VersionChildMaskOrder/${orderId}/versions`, headers: bearer(tok) });
  expect(res.statusCode).toBe(200);
  return (res.json().data as Array<{ changes: Change[] }>).flatMap((v) => v.changes);
}

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  signToken = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(ORDER);

  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk"] });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/resource/VersionChildMaskOrder",
    headers: bearer(adminTok),
    payload: { title: "Bikes", lines: [{ item: "Bolt", cost: 5 }] },
  });
  expect(created.statusCode).toBe(201);
  orderId = created.json().data._id as string;
  const rowId = (created.json().data.lines as Array<{ _row_id: string }>)[0]!._row_id;
  const updated = await app.inject({
    method: "PUT",
    url: `/api/v1/resource/VersionChildMaskOrder/${orderId}`,
    headers: bearer(adminTok),
    payload: { lines: [{ _row_id: rowId, item: "Bolt M6", cost: 7 }] },
  });
  expect(updated.statusCode).toBe(200);
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("GET /resource/:doctype/:name/versions masks the Table cells a reader may not read", () => {
  it("shows the Clerk the change of the lines without the old or new cost", async () => {
    const lines = (await changes(clerkTok)).find((c) => c.field === "lines")!;
    expect(lines.old).toEqual([expect.objectContaining({ item: "Bolt" })]);
    expect(lines.new).toEqual([expect.objectContaining({ item: "Bolt M6" })]);
    expect(JSON.stringify([lines.old, lines.new])).not.toContain("cost");
  });

  it("shows the Administrator the old and the new cost", async () => {
    const lines = (await changes(adminTok)).find((c) => c.field === "lines")!;
    expect(lines.old).toEqual([expect.objectContaining({ item: "Bolt", cost: 5 })]);
    expect(lines.new).toEqual([expect.objectContaining({ item: "Bolt M6", cost: 7 })]);
  });

  it("shows a share-only reader the level-0 Table cells and hides level-1 cells", async () => {
    const shared = await app.inject({
      method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(adminTok),
      payload: { entity: ORDER.name, document_name: orderId, shared_with: "guest@d", can_read: true, notify: false },
    });
    expect(shared.statusCode).toBe(201);
    const guest = await signToken({ sub: "guest@d", email: "guest@d", roles: ["System User"] });
    const lines = (await changes(guest)).find((change) => change.field === "lines")!;
    expect(lines.old).toEqual([expect.objectContaining({ item: "Bolt" })]);
    expect(lines.new).toEqual([expect.objectContaining({ item: "Bolt M6" })]);
    expect(JSON.stringify([lines.old, lines.new])).not.toContain("cost");
  });

  it("does not add a field-level grant to the cells a share-only reader sees", async () => {
    const shared = await app.inject({
      method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(adminTok),
      payload: { entity: ORDER.name, document_name: orderId, shared_with: "field-reader@d", can_read: true, notify: false },
    });
    expect(shared.statusCode).toBe(201);
    const token = await signToken({ sub: "field-reader@d", email: "field-reader@d", roles: ["Field Reader"] });
    const lines = (await changes(token)).find((change) => change.field === "lines")!;
    expect(lines.old).toEqual([expect.objectContaining({ item: "Bolt" })]);
    expect(lines.new).toEqual([expect.objectContaining({ item: "Bolt M6" })]);
    expect(JSON.stringify([lines.old, lines.new])).not.toContain("cost");
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/${ORDER.name}/${orderId}`, headers: bearer(token) });
    expect(read.statusCode).toBe(200);
    expect(JSON.stringify(read.json().data.lines)).not.toContain("cost");
  });
});
