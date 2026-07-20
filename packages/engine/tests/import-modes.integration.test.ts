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
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false, PERMISSION_SCOPE_ENABLED: false,
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

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: { register: (e: EntityDefinition) => void };
let adminTok: string;
let editorTok: string;

const ADMIN_PERM = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, export: 1, import: 1 };
const EDITOR_PERM = { role: "Editor", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 0, export: 0, import: 0 };

const Account: EntityDefinition = {
  name: "Account", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "acc_no",
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "acc_no", fieldtype: "Data", label: "No" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
  ],
  permissions: [ADMIN_PERM],
} as unknown as EntityDefinition;

const Group: EntityDefinition = {
  name: "Group", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "code", tree: { parent_field: "parent" },
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "code", fieldtype: "Data", label: "Code" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
    { fieldname: "parent", fieldtype: "Link", target: "Group", label: "Parent" },
  ],
  permissions: [ADMIN_PERM],
} as unknown as EntityDefinition;

const Item: EntityDefinition = {
  name: "Item", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "item_no",
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "item_no", fieldtype: "Data", label: "No" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
    { fieldname: "group", fieldtype: "Link", target: "Group", label: "Group" },
    { fieldname: "qty", fieldtype: "Int", label: "Qty" },
    { fieldname: "active", fieldtype: "Check", label: "Active" },
    { fieldname: "price", fieldtype: "Currency", label: "Price" },
    { fieldname: "launch", fieldtype: "Date", label: "Launch" },
    { fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [
      { fieldname: "account", fieldtype: "Link", target: "Account", label: "Account" },
      { fieldname: "amount", fieldtype: "Float", label: "Amount" },
    ] },
  ],
  permissions: [ADMIN_PERM, EDITOR_PERM],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });
const imp = (doctype: string, tok: string, payload: object) =>
  app.inject({ method: "POST", url: `/api/v1/import/${doctype}`, headers: bearer(tok), payload });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry as unknown as { register: (e: EntityDefinition) => void };
  await result.startup();
  await app.ready();
  for (const e of [Account, Group, Item]) {
    registry.register(e);
    await db.ensureCollection(e.name, "app");
  }

  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
  editorTok = await ta.sign({ sub: "ed@d", email: "ed@d", roles: ["Editor", "System User"], tiers: ["internal"] });

  // Baseline master data referenced by Item link tests.
  await imp("Account", adminTok, { rows: [{ acc_no: "A1", name: "Cash" }], mode: "insert" });
  await imp("Group", adminTok, { rows: [{ code: "G1", name: "Group One" }], mode: "insert" });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

async function findOne(coll: string, filter: Record<string, unknown>) {
  const rows = await db.find(coll, { filters: [filter] }, "app");
  return rows[0] as Record<string, unknown> | undefined;
}

describe("Import modes — insert / upsert / validate", () => {
  it("insert resolves Link + child-Link values by business key", async () => {
    const res = await imp("Item", adminTok, { rows: [{
      item_no: "IT1", name: "Widget", group: "G1", qty: 5, active: false, price: 9.99, launch: "2026-01-15",
      lines: [{ account: "A1", amount: 100 }],
    }], mode: "insert" });
    expect(res.statusCode).toBe(200);
    const report = res.json().data;
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(0);

    const g1 = await findOne("Group", { code: "G1" });
    const a1 = await findOne("Account", { acc_no: "A1" });
    const it1 = await findOne("Item", { item_no: "IT1" });
    expect(it1!.group).toBe(String(g1!._id)); // bk → target _id
    expect((it1!.lines as Record<string, unknown>[])[0]!.account).toBe(String(a1!._id));
    expect(it1!.qty).toBe(5);
    expect(it1!.active).toBe(false);
  });

  it("unresolved link fails only that row (link_not_found); the rest commit", async () => {
    const res = await imp("Item", adminTok, { rows: [
      { item_no: "IT_BAD", name: "Bad", group: "NOPE" },
      { item_no: "IT_OK", name: "Ok", group: "G1" },
    ], mode: "insert" });
    expect(res.statusCode).toBe(200);
    const report = res.json().data;
    expect(report.inserted).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.errors[0].message_key).toBe("link_not_found");
    expect(await findOne("Item", { item_no: "IT_BAD" })).toBeUndefined();
    expect(await findOne("Item", { item_no: "IT_OK" })).toBeDefined();
  });

  it("upsert updates an existing row by bk (stable _id) and inserts a new one", async () => {
    await imp("Item", adminTok, { rows: [{ item_no: "UP1", name: "First", group: "G1" }], mode: "insert" });
    const before = await findOne("Item", { item_no: "UP1" });

    const res = await imp("Item", adminTok, { rows: [
      { item_no: "UP1", name: "First Renamed", group: "G1" },
      { item_no: "UP2", name: "Second", group: "G1" },
    ], mode: "upsert" });
    const report = res.json().data;
    expect(report.updated).toBe(1);
    expect(report.inserted).toBe(1);

    const after = await findOne("Item", { item_no: "UP1" });
    expect(after!._id).toStrictEqual(before!._id); // _id stable
    expect(after!.name).toBe("First Renamed");
    expect(await findOne("Item", { item_no: "UP2" })).toBeDefined();
  });

  it("validate (dry-run) writes nothing but reports would-be counts", async () => {
    const countBefore = (await db.find("Item", {}, "app")).length;
    const res = await imp("Item", adminTok, { rows: [
      { item_no: "DRY1", name: "Dry", group: "G1" },
      { item_no: "DRY_BAD", name: "Bad", group: "MISSING" },
    ], mode: "validate" });
    const report = res.json().data;
    expect(report.dry_run).toBe(true);
    expect(report.inserted).toBe(1);   // DRY1 would insert
    expect(report.failed).toBe(1);     // DRY_BAD unresolved link
    const countAfter = (await db.find("Item", {}, "app")).length;
    expect(countAfter).toBe(countBefore); // ZERO writes
    expect(await findOne("Item", { item_no: "DRY1" })).toBeUndefined();
  });

  it("upsert row missing its own business key → row error import_missing_business_key", async () => {
    const res = await imp("Item", adminTok, { rows: [{ name: "no key", group: "G1" }], mode: "upsert" });
    const report = res.json().data;
    expect(report.failed).toBe(1);
    expect(report.errors[0].message_key).toBe("import_missing_business_key");
  });

  it("enforces IMPORT_MAX_ROWS (101 rows → 400)", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ item_no: `CAP${i}`, group: "G1" }));
    const res = await imp("Item", adminTok, { rows, mode: "insert" });
    expect(res.statusCode).toBe(400);
  });

  it("role without the import bit → 403", async () => {
    const res = await imp("Item", editorTok, { rows: [{ item_no: "E1", group: "G1" }], mode: "insert" });
    expect(res.statusCode).toBe(403);
  });

  it("unknown column → 400 before any write", async () => {
    const res = await imp("Item", adminTok, { rows: [{ item_no: "UNK1", nonsense: "x", group: "G1" }], mode: "insert" });
    expect(res.statusCode).toBe(400);
    expect(await findOne("Item", { item_no: "UNK1" })).toBeUndefined();
  });

  it("tree file uploaded child-before-parent imports via topological order", async () => {
    const res = await imp("Group", adminTok, { rows: [
      { code: "CH", name: "Child", parent: "PA" },
      { code: "PA", name: "Parent" },
    ], mode: "insert" });
    const report = res.json().data;
    expect(report.inserted).toBe(2);
    const pa = await findOne("Group", { code: "PA" });
    const ch = await findOne("Group", { code: "CH" });
    expect(ch!.parent).toBe(String(pa!._id)); // self-link resolved by bk
  });

  it("a self-link cycle fails its members with import_circular_reference", async () => {
    const res = await imp("Group", adminTok, { rows: [
      { code: "CY1", parent: "CY2" },
      { code: "CY2", parent: "CY1" },
    ], mode: "insert" });
    const report = res.json().data;
    expect(report.inserted).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.errors.every((e: { message_key?: string }) => e.message_key === "import_circular_reference")).toBe(true);
  });

  it("CSV body: fieldtypes decode (Check 'false' → false, Int/Float/Date, Table JSON cell)", async () => {
    const csv =
      "item_no,name,group,qty,active,price,launch,lines\r\n" +
      'CS1,CsvItem,G1,7,false,12.5,2026-03-01,"[{""account"":""A1"",""amount"":50}]"\r\n';
    const res = await imp("Item", adminTok, { csv, mode: "insert" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.inserted).toBe(1);
    const cs1 = await findOne("Item", { item_no: "CS1" });
    expect(cs1!.qty).toBe(7);
    expect(cs1!.active).toBe(false); // critical: NOT coerced to true
    expect(cs1!.price).toBe(12.5);
    expect(cs1!.launch).toBe("2026-03-01");
    const line = (cs1!.lines as Record<string, unknown>[])[0]!;
    const a1 = await findOne("Account", { acc_no: "A1" });
    expect(line.account).toBe(String(a1!._id));
    expect(line.amount).toBe(50);
  });
});
