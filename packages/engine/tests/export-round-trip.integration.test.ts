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

const ADMIN_PERM = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, export: 1, import: 1 };

const Account: EntityDefinition = {
  name: "RtAccount", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "acc_no", is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "acc_no", fieldtype: "Data", label: "No" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
  ],
  permissions: [ADMIN_PERM],
} as unknown as EntityDefinition;

const Group: EntityDefinition = {
  name: "RtGroup", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "code", tree: { parent_field: "parent" },
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "code", fieldtype: "Data", label: "Code" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
    { fieldname: "parent", fieldtype: "Link", target: "RtGroup", label: "Parent" },
  ],
  permissions: [ADMIN_PERM],
} as unknown as EntityDefinition;

const Item: EntityDefinition = {
  name: "RtItem", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "item_no", is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "item_no", fieldtype: "Data", label: "No" },
    { fieldname: "name", fieldtype: "Data", label: "Name" },
    { fieldname: "group", fieldtype: "Link", target: "RtGroup", label: "Group" },
    { fieldname: "price", fieldtype: "Currency", label: "Price" },
    { fieldname: "launch", fieldtype: "Date", label: "Launch" },
    { fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [
      { fieldname: "account", fieldtype: "Link", target: "RtAccount", label: "Account" },
      { fieldname: "amount", fieldtype: "Float", label: "Amount", precision: 2 },
    ] },
  ],
  permissions: [ADMIN_PERM],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });
const imp = (doctype: string, payload: unknown) =>
  app.inject({ method: "POST", url: `/api/v1/import/${doctype}`, headers: bearer(adminTok), payload });
const exp = (doctype: string, qs = "") =>
  app.inject({ method: "GET", url: `/api/v1/export/${doctype}${qs}`, headers: bearer(adminTok) });

const sortByBk = (rows: Record<string, unknown>[]) =>
  [...rows].sort((a, b) => String(a.item_no).localeCompare(String(b.item_no)));

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

  // Seed targets + a small master-detail set via the real import pipeline.
  await imp("RtAccount", { rows: [{ acc_no: "A1", name: "Cash" }, { acc_no: "A2", name: "Bank" }], mode: "insert" });
  await imp("RtGroup", { rows: [{ code: "PARENT", name: "Parent" }, { code: "CHILD", name: "Child", parent: "PARENT" }], mode: "insert" });
  await imp("RtItem", { rows: [
    { item_no: "IT1", name: "Widget", group: "CHILD", price: 9.99, launch: "2026-01-15", lines: [{ account: "A1", amount: 100 }, { account: "A2", amount: 25.5 }] },
    { item_no: "IT2", name: "Gadget", group: "PARENT", price: 4.5, launch: "2026-02-20", lines: [{ account: "A1", amount: 7.25 }] },
  ], mode: "insert" });
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("Export round-trip", () => {
  it("round_trip export includes child tables (B5), links as business keys, no system fields", async () => {
    const res = await exp("RtItem", "?round_trip=true");
    expect(res.statusCode).toBe(200);
    const rows = sortByBk(res.json().data);
    const it1 = rows[0]!;
    expect(it1.group).toBe("CHILD");                 // link → bk, not _id
    expect(Array.isArray(it1.lines)).toBe(true);      // B5: Table present
    const lines = it1.lines as Record<string, unknown>[];
    expect(lines[0]!.account).toBe("A1");             // child link → bk
    expect("_id" in it1).toBe(false);                 // system-named → _id stripped
    expect("creation" in it1).toBe(false);
    expect("docstatus" in it1).toBe(false);
    expect("_link_titles" in it1).toBe(false);
    expect("_row_id" in lines[0]!).toBe(false);       // child _row_id stripped
  });

  it("export → wipe → import → re-export is deep-equal on business content (JSON)", async () => {
    const first = sortByBk((await exp("RtItem", "?round_trip=true")).json().data);

    await db.deleteMany("RtItem", {}, "app");
    expect((await db.find("RtItem", {}, "app")).length).toBe(0);

    const back = await imp("RtItem", { rows: first, mode: "insert" });
    expect(back.json().data.inserted).toBe(2);

    const second = sortByBk((await exp("RtItem", "?round_trip=true")).json().data);
    expect(second).toEqual(first);
  });

  it("CSV round-trip is deep-equal too", async () => {
    const firstJson = sortByBk((await exp("RtItem", "?round_trip=true")).json().data);
    const csv = (await exp("RtItem", "?round_trip=true&format=csv")).body;
    expect(csv).toContain("item_no");
    expect(csv).not.toContain("_id"); // system fields stripped

    await db.deleteMany("RtItem", {}, "app");
    const back = await imp("RtItem", { csv, mode: "insert" });
    expect(back.json().data.inserted).toBe(2);

    const second = sortByBk((await exp("RtItem", "?round_trip=true")).json().data);
    expect(second).toEqual(firstJson);
  });

  it("default export (no flags) includes Table AND keeps system fields, links as _id", async () => {
    const rows = sortByBk((await exp("RtItem")).json().data);
    const it1 = rows[0]!;
    expect(Array.isArray(it1.lines)).toBe(true);      // B5 also fixes the default shape
    expect("docstatus" in it1).toBe(true);            // system fields retained
    expect("_id" in it1).toBe(true);
    expect(String(it1.group)).toMatch(/^[0-9a-f]{24}$/); // raw _id, not a bk
  });
});
