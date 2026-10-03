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
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100, LIST_GATED_MAX_ROWS: 5000,
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
import { DocumentService } from "../src/core/document/document-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { VersionService } from "../src/core/version/version-service.js";

let replSet: ReplicaFixture;
let app: FastifyInstance;
let db: MongoDBService;
let adminTok: string;
let clerkTok: string;
let adminDocId: string;
let clerkDocId: string;
let signToken: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

/** A change-tracked entity whose level-1 field a Clerk reads only on the documents it owns. */
const PAY: EntityDefinition = {
  name: "VersionMaskPay",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "VMP-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: true,
  track_views: false,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "salary", fieldtype: "Int", label: "Salary", perm_level: 1 },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "Administrator", level: 1, read: 1, write: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1 },
    { role: "Clerk", level: 1, read: 1, if_owner: true },
    { role: "Field Reader", level: 1, read: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

const SHARED_QUERY: EntityDefinition = {
  ...PAY, name: "SharedQueryPay", track_changes: false, naming: { strategy: "user_set" }, search_fields: ["secret"],
  fields: [...PAY.fields, { fieldname: "secret", fieldtype: "Data", perm_level: 1 },
    { fieldname: "lines", fieldtype: "Table", child_fields: [{ fieldname: "qty", fieldtype: "Int" }, { fieldname: "cost", fieldtype: "Int", perm_level: 1 }] }],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, create: 1 },
    { role: "Clerk", level: 0, select: 1, read: 1, if_owner: true },
    { role: "Field Reader", level: 1, read: 1 },
  ],
} as EntityDefinition;
const CONDITIONAL_SHARED_QUERY = { ...SHARED_QUERY, name: "ConditionalSharedQueryPay", permissions: SHARED_QUERY.permissions.map((permission) =>
  permission.role === "Clerk" ? { ...permission, if_owner: undefined, condition: "eval:doc.owner == user.email" } : permission) } as EntityDefinition;
const DOLLAR_SHARED_QUERY = { ...SHARED_QUERY, name: "DollarSharedQueryPay" } as EntityDefinition;
const LEGACY_SHARED_QUERY = { ...SHARED_QUERY, name: "LegacySharedQueryPay" } as EntityDefinition;
let sharedReaderTok: string;

async function sharedList(entity: EntityDefinition, query: Record<string, unknown> = {}) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  const res = await app.inject({ method: "GET", url: `/api/v1/resource/${entity.name}?${params}`, headers: bearer(sharedReaderTok) });
  expect(res.statusCode).toBe(200);
  return res.json() as { data: Record<string, unknown>[]; meta: { total: number } };
}

async function createAndRaiseSalary(tok: string): Promise<string> {
  const created = await app.inject({ method: "POST", url: "/api/v1/resource/VersionMaskPay", headers: bearer(tok), payload: { title: "Contract" } });
  expect(created.statusCode).toBe(201);
  const id = created.json().data._id as string;
  const updated = await app.inject({ method: "PUT", url: `/api/v1/resource/VersionMaskPay/${id}`, headers: bearer(adminTok), payload: { salary: 9000 } });
  expect(updated.statusCode).toBe(200);
  return id;
}

async function changedFields(tok: string, id: string): Promise<string[]> {
  const res = await app.inject({ method: "GET", url: `/api/v1/resource/VersionMaskPay/${id}/versions`, headers: bearer(tok) });
  expect(res.statusCode).toBe(200);
  const versions = res.json().data as Array<{ changes: Array<{ field: string }> }>;
  return versions.flatMap((v) => v.changes.map((c) => c.field));
}

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(PAY);

  signToken = ta.sign;
  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk"] });

  adminDocId = await createAndRaiseSalary(adminTok);
  clerkDocId = await createAndRaiseSalary(clerkTok);
  const share = await app.inject({
    method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(adminTok),
    payload: { entity: PAY.name, document_name: adminDocId, shared_with: "guest@d", can_read: true, notify: false },
  });
  expect(share.statusCode).toBe(201);
  sharedReaderTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk", "Field Reader"] });
  for (const entity of [SHARED_QUERY, CONDITIONAL_SHARED_QUERY, DOLLAR_SHARED_QUERY]) {
    (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(entity);
    const sharedId = entity === DOLLAR_SHARED_QUERY ? "$salary" : "SHARED";
    for (const [id, owner, salary, secret] of [[sharedId, "admin@d", 9000, "shared-secret"], ["OWNED", "clerk@d", 8000, "owned-secret"]] as const) {
      await db.insertOne(entity.name, { _id: id, owner, title: id, salary, secret,
        lines: [{ _row_id: "r1", idx: 1, qty: 2, cost: salary }], modified: new Date("2026-01-01") }, entity.database);
      const shared = await app.inject({ method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(adminTok),
        payload: { entity: entity.name, document_name: id, shared_with: "clerk@d", can_read: true, notify: false } });
      expect(shared.statusCode).toBe(201);
    }
  }
  (result.registry as unknown as { register: (e: EntityDefinition) => void }).register(LEGACY_SHARED_QUERY);
  for (const [id, lines] of [["DATE", [new Date("2026-01-01")]], ["ARRAY", [[{ cost: 9000 }]]]] as const) {
    await db.insertOne(LEGACY_SHARED_QUERY.name, { _id: id, owner: "admin@d", title: id, lines }, LEGACY_SHARED_QUERY.database);
    const shared = await app.inject({ method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(adminTok),
      payload: { entity: LEGACY_SHARED_QUERY.name, document_name: id, shared_with: "clerk@d", can_read: true, notify: false } });
    expect(shared.statusCode).toBe(201);
  }
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe.each([SHARED_QUERY, CONDITIONAL_SHARED_QUERY])("shared list comparisons for $name", (entity) => {
  it("matches neither a hidden scalar nor hidden Table cells on a share-only row", async () => {
    for (const [field, value] of [["salary", 9000], ["lines.cost", 9000]] as const) {
      const result = await sharedList(entity, { filters: [["_id", "=", "SHARED"], [field, "=", value]] });
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    }
    const hidden = await sharedList(entity, { filters: [["_id", "=", "SHARED"], ["lines", "in", [{ _row_id: "r1", idx: 1, qty: 2, cost: 9000 }]]] });
    expect(hidden.data).toEqual([]);
    expect(hidden.meta.total).toBe(0);
    const visible = await sharedList(entity, { filters: [["_id", "=", "SHARED"], ["lines", "in", [{ _row_id: "r1", idx: 1, qty: 2 }]]] });
    expect(visible.data.map((row) => row["_id"])).toEqual(["SHARED"]);
    expect(visible.meta.total).toBe(1);
  });

  it("does not select a share-only row by its hidden search value", async () => {
    const result = await sharedList(entity, { search: "shared-secret" });
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("sorts a share-only row by its visible missing salary, and counts/pages those masked matches", async () => {
    const first = await sharedList(entity, { order_by: "salary asc", limit: "1" });
    expect(first.data.map((row) => row["_id"])).toEqual(["SHARED"]);
    expect(first.meta.total).toBe(2);
    expect(first.data[0]).not.toHaveProperty("salary");
    const last = await sharedList(entity, { order_by: "salary asc", limit: "1", offset: "1" });
    expect(last.data[0]).toMatchObject({ _id: "OWNED", salary: 8000 });
  });

  it("preserves level-1 query/read values on an RBAC-admitted record that also has a share", async () => {
    const result = await sharedList(entity, { filters: [["_id", "=", "OWNED"], ["salary", ">", 5000]] });
    expect(result.meta.total).toBe(1);
    expect(result.data).toEqual([expect.objectContaining({ _id: "OWNED", salary: 8000, secret: "owned-secret", lines: [expect.objectContaining({ cost: 8000 })] })]);
    const projected = await sharedList(entity, { fields: ["_id", "salary"], order_by: "_id asc" });
    expect(projected.data).toEqual([{ _id: "OWNED", salary: 8000 }, { _id: "SHARED" }]);
  });
});

it("treats dollar-prefixed shared document IDs as literals inside the query mask", async () => {
  const hidden = await sharedList(DOLLAR_SHARED_QUERY, { filters: [["_id", "=", "$salary"], ["salary", "=", 9000]] });
  expect(hidden.data).toEqual([]);
  expect(hidden.meta.total).toBe(0);
  const visible = await sharedList(DOLLAR_SHARED_QUERY, { filters: [["_id", "=", "$salary"]] });
  expect(visible.data.map((row) => row["_id"])).toEqual(["$salary"]);
  expect(visible.data[0]).not.toHaveProperty("salary");
});

it("masks legacy Date and array-shaped Table rows before shared-list comparisons", async () => {
  const result = await sharedList(LEGACY_SHARED_QUERY, { filters: [["lines", "in", [{}]]], order_by: "_id asc" });
  expect(result.data.map((row) => row["_id"])).toEqual(["ARRAY", "DATE"]);
  expect(result.data.map((row) => row["lines"])).toEqual([[{}], [{}]]);
  expect(result.meta.total).toBe(2);
});

it("keeps an Administrator's all-fields mask when a personal record is admitted by sharing", async () => {
  const alice = await signToken({ sub: "alice@d", email: "alice@d", roles: ["System User"] });
  const preference = await app.inject({ method: "POST", url: "/api/v1/resource/UserPreference", headers: bearer(alice),
    payload: { pref_key: "shared-mask", value: "visible-preference" } });
  expect(preference.statusCode).toBe(201);
  const id = preference.json().data._id as string;
  const share = await app.inject({ method: "POST", url: "/api/v1/resource/DocShare", headers: bearer(alice),
    payload: { entity: "UserPreference", document_name: id, shared_with: "admin@d", can_read: true, notify: false } });
  expect(share.statusCode).toBe(201);
  const list = async (filters: unknown[]) => {
    const response = await app.inject({ method: "GET", url: `/api/v1/resource/UserPreference?${new URLSearchParams({ filters: JSON.stringify(filters) })}`, headers: bearer(adminTok) });
    expect(response.statusCode).toBe(200);
    return response.json() as { data: Record<string, unknown>[]; meta: { total: number } };
  };
  const included = await list([["_id", "=", id]]);
  expect(included.data).toEqual([expect.objectContaining({ _id: id, value: "visible-preference", owner: "alice@d" })]);
  expect(included.meta.total).toBe(1);
  const excluded = await list([["_id", "=", "unmatched-preference"]]);
  expect(excluded.data).toEqual([]);
  expect(excluded.meta.total).toBe(0);
});

describe("GET /resource/:doctype/:name/versions masks changes by the grants that hold on the document", () => {
  it("hides the level-1 change on a document the Clerk does not own", async () => {
    expect(await changedFields(adminTok, adminDocId)).toContain("salary");
    expect(await changedFields(clerkTok, adminDocId)).not.toContain("salary");
  });

  it("shows the level-1 change on a document the Clerk owns", async () => {
    expect(await changedFields(clerkTok, clerkDocId)).toContain("salary");
  });
});

describe("GET /resource/:doctype/:name/versions for a reader whom only a share admits", () => {
  it("shows the level-0 change and hides the level-1 change, as the record read does", async () => {
    const renamed = await app.inject({ method: "PUT", url: `/api/v1/resource/VersionMaskPay/${adminDocId}`, headers: bearer(adminTok), payload: { title: "Renewed contract" } });
    expect(renamed.statusCode).toBe(200);
    await new VersionService(db).createVersionFromChanges("VersionMaskPay", adminDocId, [
      { field: "owner", old: "former@d", new: "admin@d" },
      { field: "modified_by", old: "former@d", new: "admin@d" },
    ], "admin@d");
    const guestTok = await signToken({ sub: "guest@d", email: "guest@d", roles: ["System User"] });
    const fields = await changedFields(guestTok, adminDocId);
    expect([fields.includes("title"), fields.includes("owner"), fields.includes("modified_by"), fields.includes("salary")])
      .toEqual([true, true, true, false]);
  });

  it("answers shared-only read only for an actual admitting share", async () => {
    const registry = { get: () => PAY } as never;
    const service = new DocumentService({ db, registry, permissionChecker: new PermissionChecker(registry) } as never);
    const guest = { _id: "guest@d", email: "guest@d", roles: ["System User"] } as never;
    expect(await service.isSharedForReadOnly(guest, PAY.name, { _id: clerkDocId })).toBe(false);
    expect(await service.isSharedForReadOnly(guest, PAY.name, { _id: adminDocId })).toBe(true);
    const admin = { _id: "admin@d", email: "admin@d", roles: ["Administrator"] } as never;
    expect(await service.isSharedForReadOnly(admin, PAY.name, { _id: adminDocId })).toBe(false);
    const token = await signToken({ sub: "guest@d", email: "guest@d", roles: ["System User"] });
    const denied = await app.inject({ method: "GET", url: `/api/v1/resource/VersionMaskPay/${clerkDocId}/versions`, headers: bearer(token) });
    expect(denied.statusCode).toBe(403);
  });

  it("keeps higher-level fields hidden when a share recipient holds no entity read but a field-level grant", async () => {
    const token = await signToken({ sub: "guest@d", email: "guest@d", roles: ["Field Reader"] });
    const fields = await changedFields(token, adminDocId);
    expect(fields).toContain("title");
    expect(fields).not.toContain("salary");
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/VersionMaskPay/${adminDocId}`, headers: bearer(token) });
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toHaveProperty("title");
    expect(read.json().data).not.toHaveProperty("salary");
  });
});
