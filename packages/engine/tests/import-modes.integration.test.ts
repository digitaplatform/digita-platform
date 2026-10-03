import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

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

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { readBundle } from "@digitaplatform/shared/i18n-node";
import { IndexManager } from "../src/core/database/index-manager.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: Awaited<ReturnType<typeof createApp>>["registry"];
let adminTok: string;
let editorTok: string;
let clerkTok: string;

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
  business_key: "code", tree: {},
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "code", fieldtype: "Data", label: "Code" },
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

const CLERK_PERM = { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 0, export: 1, import: 1 };

// `step` is read_only, so every role but Administrator keeps its stored value.
const Checklist: EntityDefinition = {
  name: "Checklist", module: "test", database: "app", naming: { strategy: "system" },
  business_key: "code",
  is_submittable: false, is_log: false, track_changes: false, track_views: false,
  fields: [
    { fieldname: "code", fieldtype: "Data", label: "Code" },
    { fieldname: "steps", fieldtype: "Table", label: "Steps", child_fields: [
      { fieldname: "step", fieldtype: "Data", label: "Step", read_only: true, default: "Extra step" },
      { fieldname: "done", fieldtype: "Check", label: "Done" },
    ] },
  ],
  permissions: [ADMIN_PERM, CLERK_PERM],
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
  registry = result.registry;
  await result.startup();
  await app.ready();
  registry.prepareDefinition(Group);
  for (const e of [Account, Group, Item, Checklist]) {
    registry.register(e);
    await db.ensureCollection(e.name, "app");
  }

  adminTok = await ta.sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
  editorTok = await ta.sign({ sub: "ed@d", email: "ed@d", roles: ["Editor", "System User"], tiers: ["internal"] });
  clerkTok = await ta.sign({ sub: "clerk@d", email: "clerk@d", roles: ["Clerk", "System User"], tiers: ["internal"] });

  // Baseline master data referenced by Item link tests.
  await imp("Account", adminTok, { rows: [{ acc_no: "A1", name: "Cash" }], mode: "insert" });
  await imp("Group", adminTok, { rows: [{ code: "G1", label: "Group One" }], mode: "insert" });
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
    expect(report.errors[0].code).toBe("link_not_found");
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
    expect(report.errors[0].code).toBe("import_missing_business_key");
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
      { code: "CH", label: "Child", parent: "PA" },
      { code: "PA", label: "Parent" },
    ], mode: "insert" });
    const report = res.json().data;
    expect(report.inserted).toBe(2);
    const pa = await findOne("Group", { code: "PA" });
    const ch = await findOne("Group", { code: "CH" });
    expect(ch!.parent).toBe(String(pa!._id)); // self-link resolved by bk
  });

  it("takes a tree's _ancestors, _depth and _tree_rev columns, and stores the engine's place instead", async () => {
    const res = await imp("Group", adminTok, { rows: [
      { code: "TA", label: "Top", _ancestors: ["X"], _depth: 9, _tree_rev: 4 },
      { code: "TB", label: "Below", parent: "TA", _ancestors: ["Y"], _depth: 9 },
    ], mode: "insert" });
    expect(res.json().data.inserted).toBe(2);
    const ta = await findOne("Group", { code: "TA" });
    const tb = await findOne("Group", { code: "TB" });
    expect([ta!._ancestors, ta!._depth, tb!._ancestors, tb!._depth]).toEqual([[], 1, [String(ta!._id)], 2]);
  });

  it("a self-link cycle fails its members with import_circular_reference", async () => {
    const res = await imp("Group", adminTok, { rows: [
      { code: "CY1", parent: "CY2" },
      { code: "CY2", parent: "CY1" },
    ], mode: "insert" });
    const report = res.json().data;
    expect(report.inserted).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.errors.every((e: { code?: string }) => e.code === "import_circular_reference")).toBe(true);
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

  it("a file that repeats a child row's _row_id fails that row and stores nothing", async () => {
    const res = await imp("Item", adminTok, { rows: [{
      item_no: "RID1", name: "Repeat", group: "G1",
      lines: [{ _row_id: "R1", account: "A1", amount: 1 }, { _row_id: "R1", account: "A1", amount: 2 }],
    }], mode: "insert" });
    expect(res.json().data.inserted).toBe(0);
    expect(res.json().data.failed).toBe(1);
    expect(await findOne("Item", { item_no: "RID1" })).toBeUndefined();
  });

  it("upsert keeps a stored row's read_only child value for a role that may not write it (#256)", async () => {
    // A read_only cell comes in through a seed or a hook, never an import: the rows are stored as a seed does.
    await imp("Checklist", adminTok, { rows: [{ code: "CL1", steps: [{ done: false }, { done: false }] }], mode: "insert" });
    const inserted = (await findOne("Checklist", { code: "CL1" }))!;
    const seededSteps = (inserted.steps as Array<Record<string, unknown>>).map((row, i) => ({ ...row, step: ["Legacy", "Brakes"][i] }));
    await db.updateOne("Checklist", String(inserted._id), { steps: seededSteps }, "app");
    const stored = (await findOne("Checklist", { code: "CL1" }))!.steps as Array<Record<string, unknown>>;

    // The file names each stored row by its _row_id, as an export writes it.
    const res = await imp("Checklist", clerkTok, { rows: [{
      code: "CL1",
      steps: [
        { _row_id: stored[0]!._row_id, step: "Changed", done: true },
        { _row_id: stored[1]!._row_id, done: true },
        { step: "Changed", done: false },
      ],
    }], mode: "upsert" });
    expect(res.json().data).toMatchObject({ updated: 1, failed: 0 });

    const steps = (await findOne("Checklist", { code: "CL1" }))!.steps as Array<Record<string, unknown>>;
    expect(steps.map((s) => [s._row_id, s.step, s.done])).toEqual([
      [stored[0]!._row_id, "Legacy", true],
      [stored[1]!._row_id, "Brakes", true],
      [expect.any(String), "Extra step", false],
    ]);
  });
});

describe("An import row that repeats a unique value", () => {
  const Coupon = {
    name: "Coupon", module: "test", database: "app", naming: { strategy: "system" },
    is_submittable: false, is_log: false, track_changes: false, track_views: false,
    fields: [{ fieldname: "code", fieldtype: "Data", label: "Code", unique: true }],
    permissions: [ADMIN_PERM],
  } as unknown as EntityDefinition;

  beforeAll(async () => {
    registry.register(Coupon);
    await db.ensureCollection("Coupon", "app");
    await new IndexManager(db).ensureIndexes(Coupon);
  });

  it("PLANTED DEFECT: fails that row by the field, as the resource route refuses it, without the database's text", async () => {
    expect((await imp("Coupon", adminTok, { rows: [{ code: "SPRING" }], mode: "insert" })).json().data.inserted).toBe(1);
    const res = await imp("Coupon", adminTok, { rows: [{ code: "SPRING" }, { code: "SUMMER" }], mode: "insert" });
    expect(res.statusCode).toBe(200);
    const report = res.json().data;
    expect([report.inserted, report.failed]).toEqual([1, 1]);
    expect(report.errors[0]).toMatchObject({ row: 1, field: "code", code: "duplicate_key", params: { field: "code" } });
    expect(res.body).not.toMatch(/E11000|dup key|idx_uniq/);
  });
});

describe("The resource API refuses a Table write that repeats a _row_id", () => {
  it("answers 400 naming the repeated row and keeps the stored rows", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/Item", headers: bearer(adminTok),
      payload: { item_no: "RID2", name: "Repeat", lines: [{ amount: 1 }] },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().data as { _id: string; lines: Array<Record<string, unknown>> };
    const row = item.lines[0]!;

    const res = await app.inject({
      method: "PUT", url: `/api/v1/resource/Item/${item._id}`, headers: bearer(adminTok),
      payload: { lines: [row, { ...row, amount: 2 }] },
    });
    expect(res.statusCode).toBe(400);
    // The engine answers the key table_row_repeated, translated with its 1-based rows.
    expect(res.json().messages).toEqual([expect.objectContaining({ type: "error", path: "lines[1]" })]);
    expect(res.json().messages[0].text).toContain("1,2");
    expect(res.json().messages[0].text).not.toContain("_row_id");
    const stored = (await findOne("Item", { item_no: "RID2" }))!.lines as Record<string, unknown>[];
    expect(stored.map((l) => l.amount)).toEqual([1]);
  });
});

describe("The resource API refuses a Table value that is not a list", () => {
  it("PLANTED DEFECT: answers 400 on the field for a value that is no list, on insert and on update, and keeps the stored rows", async () => {
    for (const lines of [{}, "x"]) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/resource/Item", headers: bearer(adminTok),
        payload: { item_no: `NL-${typeof lines}`, name: "Not a list", lines },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.field).toBe("lines");
    }
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/Item", headers: bearer(adminTok),
      payload: { item_no: "NL-KEEP", name: "Keep", lines: [{ amount: 1 }] },
    });
    const id = created.json().data._id as string;
    for (const lines of [{}, "x", "", 0, false]) {
      const res = await app.inject({ method: "PUT", url: `/api/v1/resource/Item/${id}`, headers: bearer(adminTok), payload: { lines } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.field).toBe("lines");
    }
    expect(((await findOne("Item", { item_no: "NL-KEEP" }))!.lines as Record<string, unknown>[]).map((l) => l.amount)).toEqual([1]);
  });
});

describe("A Table with min_rows", () => {
  const Order = {
    name: "MinRowsOrder", module: "test", database: "app", naming: { strategy: "system" },
    is_submittable: false, is_log: false, track_changes: false, track_views: false,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "lines", fieldtype: "Table", label: "Lines", min_rows: 1, child_fields: [{ fieldname: "qty", fieldtype: "Int", label: "Qty" }] },
    ],
    permissions: [ADMIN_PERM],
  } as unknown as EntityDefinition;
  const post = (payload: object) => app.inject({ method: "POST", url: "/api/v1/resource/MinRowsOrder", headers: bearer(adminTok), payload });

  beforeAll(async () => {
    registry.register(Order);
    await db.ensureCollection("MinRowsOrder", "app");
  });

  it("PLANTED DEFECT: refuses an insert that leaves the Table out or sends null, as it refuses an empty one", async () => {
    const texts = new Set<string>();
    for (const payload of [{ title: "No key" }, { title: "Null", lines: null }, { title: "Empty", lines: [] }]) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.field).toBe("lines");
      texts.add(res.json().messages[0].text);
    }
    // All three are refused for having too few rows, not for a value of the wrong type.
    expect(texts.size).toBe(1);
  });

  it("PLANTED INNOCENT: keeps the stored rows on an update that leaves the Table out", async () => {
    const created = await post({ title: "Has rows", lines: [{ qty: 2 }] });
    expect(created.statusCode).toBe(201);
    const id = created.json().data._id as string;
    const res = await app.inject({ method: "PUT", url: `/api/v1/resource/MinRowsOrder/${id}`, headers: bearer(adminTok), payload: { title: "Renamed" } });
    expect(res.statusCode).toBe(200);
    expect(((await findOne("MinRowsOrder", { title: "Renamed" }))!.lines as Record<string, unknown>[]).map((l) => l.qty)).toEqual([2]);
  });
});

describe("An engine error reaches a person in their language (#24)", () => {
  const german = (tok: string) => ({ ...bearer(tok), "accept-language": "de-CH,de;q=0.9" });

  it("answers a missing document and a refused delete in German, as a code with params", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/resource/Item/NOPE-1", headers: german(adminTok) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().messages[0].text).toBe("Item NOPE-1 nicht gefunden");
    expect(missing.json().error).toMatchObject({ code: "NOT_FOUND", detail: "not_found" });

    const item = (await findOne("Item", { item_no: "IT1" }))!;
    const refused = await app.inject({ method: "DELETE", url: `/api/v1/resource/Item/${String(item._id)}`, headers: german(editorTok) });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().messages[0].text).toBe("Du hast keine Berechtigung, Item zu löschen");
    expect(refused.json().error).toMatchObject({ code: "PERMISSION_DENIED", detail: "permission_denied_delete" });
    expect(JSON.stringify(refused.json())).not.toContain("ed@d");
  });

  it("PLANTED DEFECT: answers a save a validate rule refuses with 400 and the rule's message, not a 500", async () => {
    // An entity of its own: the rule engine caches each entity's rules for a while once read.
    const Parcel = {
      name: "RuleParcel", module: "test", database: "app", naming: { strategy: "system" },
      is_submittable: false, is_log: false, track_changes: false, track_views: false,
      fields: [{ fieldname: "weight", fieldtype: "Int", label: "Weight" }],
      permissions: [ADMIN_PERM],
    } as unknown as EntityDefinition;
    registry.register(Parcel);
    await db.ensureCollection("RuleParcel", "app");
    const rule = await app.inject({
      method: "POST", url: "/api/v1/resource/Rule", headers: bearer(adminTok),
      payload: {
        _id: "parcel-weight", label: "Parcels weigh something", entity: "RuleParcel", event: "validate", enabled: 1,
        actions: [{ type: "validate", condition: "doc.weight > 0", message: "A parcel weighs more than nothing" }],
      },
    });
    expect(rule.statusCode).toBe(201);
    const res = await app.inject({ method: "POST", url: "/api/v1/resource/RuleParcel", headers: german(adminTok), payload: { weight: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().messages[0].text).toBe("A parcel weighs more than nothing");
    expect(res.json().error).toMatchObject({ code: "RULE_REFUSED", detail: "rule_refused" });
    expect(await db.count("RuleParcel", [], "app")).toBe(0);
  });

  it("answers a delete that other records block with 409 in German, with the blockers", async () => {
    const group = (await findOne("Group", { code: "G1" }))!;
    const res = await app.inject({ method: "DELETE", url: `/api/v1/resource/Group/${String(group._id)}`, headers: german(adminTok) });
    expect(res.statusCode).toBe(409);
    expect(res.json().messages[0].text).toMatch(/^Löschen nicht möglich: [1-9]\d* Item verweisen auf dieses Dokument$/);
    expect(res.json().error).toMatchObject({ code: "DELETE_BLOCKED", detail: "link_delete_blocked" });
  });

  it("answers a record whose numbering field is empty with 400 in German, bound to the field, not a 500", async () => {
    const Ticket = {
      name: "NamedTicket", module: "test", database: "app", naming: { strategy: "by_field", field: "code" },
      is_submittable: false, is_log: false, track_changes: false, track_views: false,
      fields: [{ fieldname: "code", fieldtype: "Data", label: "Code" }, { fieldname: "note", fieldtype: "Data", label: "Note" }],
      permissions: [ADMIN_PERM],
    } as unknown as EntityDefinition;
    registry.register(Ticket);
    await db.ensureCollection("NamedTicket", "app");
    const res = await app.inject({ method: "POST", url: "/api/v1/resource/NamedTicket", headers: german(adminTok), payload: { note: "no code" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().messages[0]).toMatchObject({ text: 'Feld "code" wird für die Nummerierung benötigt.', path: "code" });
    expect(res.json().error).toMatchObject({ code: "NAMING_FIELD_REQUIRED", detail: "naming_field_required", field: "code" });
  });

  it("answers a save into a closed period and a date no period covers in German", async () => {
    const de = readBundle(process.env.TRANSLATIONS_DIR!).de!;
    const FiscalPeriod = {
      name: "FiscalPeriod", module: "test", database: "app", naming: { strategy: "system" },
      is_submittable: false, is_log: false, track_changes: false, track_views: false,
      fields: [
        { fieldname: "start_date", fieldtype: "Date", label: "Start" },
        { fieldname: "end_date", fieldtype: "Date", label: "End" },
        { fieldname: "is_closed", fieldtype: "Check", label: "Closed" },
      ],
      permissions: [ADMIN_PERM],
    } as unknown as EntityDefinition;
    const Voucher = {
      name: "Voucher", module: "test", database: "app", naming: { strategy: "system" },
      is_submittable: false, is_log: false, track_changes: false, track_views: false,
      period_check: { date_field: "posting_date", period_entity: "FiscalPeriod", block_on: ["insert"] },
      fields: [{ fieldname: "posting_date", fieldtype: "Date", label: "Posting date" }],
      permissions: [ADMIN_PERM],
    } as unknown as EntityDefinition;
    for (const e of [FiscalPeriod, Voucher]) {
      registry.register(e);
      await db.ensureCollection(e.name, "app");
    }
    const period = await app.inject({
      method: "POST", url: "/api/v1/resource/FiscalPeriod", headers: bearer(adminTok),
      payload: { start_date: "2026-01-01", end_date: "2026-01-31", is_closed: 1 },
    });
    expect(period.statusCode).toBe(201);

    const closed = await app.inject({ method: "POST", url: "/api/v1/resource/Voucher", headers: german(adminTok), payload: { posting_date: "2026-01-15" } });
    expect(closed.statusCode).toBe(409);
    expect(closed.json().messages[0].text).toBe(de["period_closed"]);
    expect(closed.json().error).toMatchObject({ code: "PERIOD_CLOSED", detail: "period_closed" });

    const uncovered = await app.inject({ method: "POST", url: "/api/v1/resource/Voucher", headers: german(adminTok), payload: { posting_date: "2027-05-01" } });
    expect(uncovered.statusCode).toBe(400);
    expect(uncovered.json().messages[0].text).toBe(de["period_not_found_for_date"]);
    expect(uncovered.json().error).toMatchObject({ code: "PERIOD_NOT_FOUND", detail: "period_not_found_for_date" });
    expect(await db.count("Voucher", [], "app")).toBe(0);
  });

  it("answers a state the workflow does not allow with 409 in German", async () => {
    const Ticket = {
      name: "FlowTicket", module: "test", database: "app", naming: { strategy: "system" },
      is_submittable: false, is_log: false, track_changes: false, track_views: false,
      fields: [{ fieldname: "status", fieldtype: "Data", label: "Status" }],
      states: [{ value: "open", is_initial: true }, { value: "done" }],
      transitions: [{ from: "open", to: "done" }],
      permissions: [ADMIN_PERM],
    } as unknown as EntityDefinition;
    registry.register(Ticket);
    await db.ensureCollection("FlowTicket", "app");
    const created = await app.inject({ method: "POST", url: "/api/v1/resource/FlowTicket", headers: bearer(adminTok), payload: {} });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: "PUT", url: `/api/v1/resource/FlowTicket/${created.json().data._id as string}`, headers: german(adminTok), payload: { status: "archived" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().messages[0].text).toBe(readBundle(process.env.TRANSLATIONS_DIR!).de!["illegal_transition"]);
    expect(res.json().error).toMatchObject({ code: "ILLEGAL_TRANSITION", detail: "illegal_transition" });
  });

  it("answers an empty import and a malformed list parameter in German", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/v1/import/Item", headers: german(adminTok), payload: { rows: [], mode: "insert" } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().messages[0].text).toBe("Der Import enthält keine Zeilen.");
    expect(empty.json().error).toMatchObject({ code: "BAD_REQUEST", detail: "import_nothing" });

    const list = await app.inject({ method: "GET", url: "/api/v1/resource/Item?limit=many", headers: german(adminTok) });
    expect(list.statusCode).toBe(400);
    expect(list.json().messages[0].text).toBe("limit muss eine ganze Zahl von mindestens 1 sein.");
    expect(list.json().error).toMatchObject({ code: "BAD_REQUEST", detail: "param_not_whole_number" });
  });

  it("answers a malformed filter value and a malformed fields list in German", async () => {
    const value = await app.inject({
      method: "GET", url: `/api/v1/resource/Item?filters=${encodeURIComponent(JSON.stringify([["qty", "=", [1, 2]]]))}`, headers: german(adminTok),
    });
    expect(value.statusCode).toBe(400);
    expect(value.json().messages[0].text).toBe("Ein Filter mit dem Operator = nimmt einen einfachen Wert, keine Liste und kein Objekt.");
    expect(value.json().error).toMatchObject({ code: "MALFORMED_FILTER_VALUE", detail: "filter_value_malformed" });

    const fields = await app.inject({
      method: "GET", url: `/api/v1/resource/Item?fields=${encodeURIComponent(JSON.stringify(["lines", "lines.amount"]))}`, headers: german(adminTok),
    });
    expect(fields.statusCode).toBe(400);
    expect(fields.json().messages[0].text).toBe("Die Feldliste muss Feldpfade nennen, keiner innerhalb eines anderen.");
    expect(fields.json().error).toMatchObject({ code: "MALFORMED_FIELDS", detail: "fields_malformed" });
  });

  it("lists a row an import refuses with its text in German", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/import/Item", headers: german(adminTok),
      payload: { rows: [{ item_no: "IT_DE", name: "Broken link", group: "NOWHERE" }], mode: "insert" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.errors).toEqual([
      expect.objectContaining({ row: 1, code: "link_not_found", message: "Group 'NOWHERE' existiert nicht" }),
    ]);
  });

  it("answers a role rename with 400 in German, not a 500", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/resource/Role", headers: bearer(adminTok), payload: { name: "Courier", label: "Courier" } });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({ method: "PUT", url: "/api/v1/resource/Role/Courier", headers: german(adminTok), payload: { name: "Driver" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().messages[0].text).toBe(readBundle(process.env.TRANSLATIONS_DIR!).de!["role_name_immutable"]);
    expect(res.json().error).toMatchObject({ code: "ROLE_NAME_IMMUTABLE", detail: "role_name_immutable" });
  });
});
