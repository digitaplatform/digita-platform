import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Same env mock as site-scope.integration.test.ts: a self-contained fixture app, so this
// suite runs without a sibling digita-catalog checkout, in the engine-only CI too.
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
    APP_DIRS: [] as string[], SITE_ID: "", ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
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
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { projectFields } from "../src/core/document/project-fields.js";
import { DIGITA } from "@digitaplatform/shared";

// #41: a public list checks each row's Guest read `condition` on the stored row and
// projects afterwards. The renderer's page list asks for seven fields, none of them
// `status`, which its condition reads; gated on the projected row, it answered no page
// at all, and a condition that negates answered the drafts it should hide.
const APP_BASENAME = "digita-public-list-gate-fixture";
const DB = `${APP_BASENAME}_content`;
const guestPermissions = (guest: Record<string, unknown>) => [
  { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
  { role: "Guest", level: 0, select: 1, ...guest },
];
let fixtureRoot: string;

async function writeEntity(dir: string, name: string, guest: Record<string, unknown>): Promise<void> {
  await writeFile(join(dir, `${name}.entity.json`), JSON.stringify({
    name, module: "web", database: DB, naming: { strategy: "user_set" }, title_field: "title",
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true, translatable: true },
      { fieldname: "status", fieldtype: "Data", label: "Status" },
      { fieldname: "note", fieldtype: "Data", label: "Note", perm_level: 1, translatable: true },
    ],
    permissions: guestPermissions(guest),
  }), "utf-8");
}

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = join(tmpdir(), APP_BASENAME);
  await rm(fixtureRoot, { recursive: true, force: true });
  const entities = join(fixtureRoot, "content", "entities");
  await mkdir(entities, { recursive: true });
  await writeEntity(entities, "GatedPage", { read: 1, condition: "eval:doc.status=='published'" });
  await writeEntity(entities, "NegatedPage", { read: 1, condition: "eval:doc.status != 'draft'" });
  await writeEntity(entities, "ListedPage", { read: 0 });
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];

  const { authn } = await buildTestAuth();
  const booted = await createApp({ authn });
  app = booted.app;
  db = booted.db;
  await booted.startup();
  await app.ready();

  const now = new Date();
  const row = (doctype: string, _id: string, status: string, extra: Record<string, unknown> = {}) => ({
    doctype, _id, title: _id, status, docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now, ...extra,
  });
  await db.insertOne("GatedPage", row("GatedPage", "G-1", "published", {
    meta: { a: 1, b: { c: 2 } }, items: [{ q: 1, r: 2 }, 3, { r: 4 }], when: now,
    nested: [[{ x: 1, y: 2 }, 7], { x: 3, y: 4 }, 5, [[{ x: 6 }]]], ["__proto__"]: { polluted: true },
  }), DB);
  await db.insertOne("GatedPage", row("GatedPage", "G-2", "published", { note: "operator only" }), DB);
  await db.insertOne("GatedPage", row("GatedPage", "G-3", "draft"), DB);
  const translation = (document_name: string, fieldname: string, value: string) => ({
    _id: `data:GatedPage:${document_name}:en:${fieldname}`, namespace: "data", key: `GatedPage.${document_name}.${fieldname}`, entity: "GatedPage",
    document_name, locale: "en", fieldname, value, creation: now, modified: now,
  });
  await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, translation("G-2", "title", "G-2 translated"), DIGITA.DATABASES.CORE);
  await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, translation("G-2", "note", "operator only, translated"), DIGITA.DATABASES.CORE);
  await db.insertOne("NegatedPage", row("NegatedPage", "N-1", "published"), DB);
  await db.insertOne("NegatedPage", row("NegatedPage", "N-2", "draft"), DB);
  await db.insertOne("ListedPage", row("ListedPage", "L-1", "published"), DB);
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await rm(fixtureRoot, { recursive: true, force: true });
  await replSet.stop();
}, 30000);

const list = async (doctype: string, query: Record<string, unknown>) => {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, JSON.stringify(v)]));
  const res = await app.inject({ method: "GET", url: `/api/v1/public/resource/${doctype}?${qs}` });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { data: Array<Record<string, unknown>>; meta: { total: number } };
  return { ids: body.data.map((r) => r["_id"]).sort(), rows: body.data, total: body.meta.total };
};

describe("Public list gates each stored row before it projects (#41)", () => {
  it("answers the published rows when fields omit the field the condition reads", async () => {
    const { ids, rows, total } = await list("GatedPage", { fields: ["_id", "title"] });
    expect(ids).toEqual(["G-1", "G-2"]);
    expect(total).toBe(2);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["_id", "title"]);
  });

  it("answers the same rows with the condition's field in fields, and with no fields", async () => {
    expect((await list("GatedPage", { fields: ["_id", "title", "status"] })).ids).toEqual(["G-1", "G-2"]);
    expect((await list("GatedPage", {})).ids).toEqual(["G-1", "G-2"]);
  });

  it("filters on a field it does not project", async () => {
    const { ids } = await list("GatedPage", { filters: [["title", "=", "G-2"]], fields: ["_id", "status"] });
    expect(ids).toEqual(["G-2"]);
  });

  it("never answers a draft, whatever fields and filters name", async () => {
    expect((await list("GatedPage", { filters: [["status", "=", "draft"]], fields: ["_id", "title"] })).ids).toEqual([]);
    expect((await list("NegatedPage", { fields: ["_id", "title"] })).ids).toEqual(["N-1"]);
  });

  it("masks a field above the Guest's level, with and without a projection", async () => {
    for (const query of [{}, { fields: ["_id", "note"] }]) {
      const { rows } = await list("GatedPage", query);
      expect(rows.length).toBe(2);
      for (const r of rows) expect(r).not.toHaveProperty("note");
    }
  });

  it("translates a field the row carries, and never adds one the row lacks or masks", async () => {
    for (const query of [{ fields: ["_id", "title"] }, {}]) {
      const { rows } = await list("GatedPage", query);
      const g2 = rows.find((r) => r["_id"] === "G-2")!;
      expect(g2["title"]).toBe("G-2 translated");
      expect(g2).not.toHaveProperty("note");
    }
    const { rows } = await list("GatedPage", { fields: ["_id"] });
    for (const r of rows) expect(Object.keys(r)).toEqual(["_id"]);
  });

  it("refuses fields it cannot project with 400, before any query", async () => {
    for (const fields of [[1], 5, "title", ["title", "title.x"], ["$where"], [""], ["a..b"], { a: 1 }]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/public/resource/GatedPage?fields=${encodeURIComponent(JSON.stringify(fields))}` });
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
      expect(res.json().error.code).toBe("MALFORMED_FIELDS");
    }
  });

  it("refuses a fields, filters or or_filters value that is not JSON with 400", async () => {
    for (const param of ["fields", "filters", "or_filters"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/public/resource/GatedPage?${param}=abc` });
      expect(res.statusCode, param).toBe(400);
    }
  });

  it("answers no row a Guest may list but not read", async () => {
    const { ids, total } = await list("ListedPage", { fields: ["_id", "title"] });
    expect(ids).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("Public list filters and sorts only on fields the Guest may read", () => {
  it("refuses a filter, an or_filter or a sort on a field above the Guest's level with 400", async () => {
    const onNote = encodeURIComponent(JSON.stringify([["note", "=", "operator only"]]));
    for (const param of [`filters=${onNote}`, `or_filters=${onNote}`, `order_by=${encodeURIComponent("note asc")}`]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/public/resource/GatedPage?${param}` });
      expect(res.statusCode, param).toBe(400);
      expect(res.json().error.code).toBe("FILTER_FIELD_NOT_ALLOWED");
    }
    const byTitle = await app.inject({
      method: "GET",
      url: `/api/v1/public/resource/GatedPage?order_by=${encodeURIComponent("title desc")}&filters=${encodeURIComponent(JSON.stringify([["status", "=", "published"]]))}`,
    });
    expect(byTitle.statusCode).toBe(200);
    expect((byTitle.json() as { data: Array<Record<string, unknown>> }).data.map((r) => r["_id"])).toEqual(["G-2", "G-1"]);
  });
});

describe("Public list counts and pages only the rows the Guest may read", () => {
  const get = async (qs: string) => {
    const res = await app.inject({ method: "GET", url: `/api/v1/public/resource/GatedPage?${qs}` });
    expect(res.statusCode).toBe(200);
    return res.json() as { data: Array<Record<string, unknown>>; meta: { total: number; total_pages: number } };
  };
  const filters = (f: unknown) => `filters=${encodeURIComponent(JSON.stringify(f))}`;

  it("never counts a hidden draft, not even past the last page", async () => {
    expect((await get(`${filters([["status", "=", "draft"]])}&page=50&page_size=1`)).meta.total).toBe(0);
    expect((await get(`${filters([["title", "like", "G-3%"]])}&page=50&page_size=1`)).meta.total).toBe(0);
    expect((await get(`${filters([["title", "like", "G-%"]])}&page=50&page_size=1`)).meta.total).toBe(2);
  });

  it("pages over the readable rows, so each one is on exactly one page", async () => {
    const byTitle = `order_by=${encodeURIComponent("title desc")}&page_size=1`;
    const pages = await Promise.all([1, 2, 3].map((page) => get(`${byTitle}&page=${page}`)));
    expect(pages.map((p) => p.data.map((r) => r["_id"]))).toEqual([["G-2"], ["G-1"], []]);
    expect(pages[0]!.meta).toMatchObject({ total: 2, total_pages: 2 });
  });
});

describe("Public list bounds and narrows the rows it re-checks", () => {
  it("answers 400 LIST_TOO_BROAD past LIST_GATED_MAX_ROWS matching rows, and lists within it", async () => {
    const limits = env as { LIST_GATED_MAX_ROWS: number };
    const before = limits.LIST_GATED_MAX_ROWS;
    limits.LIST_GATED_MAX_ROWS = 2;
    try {
      const tooBroad = await app.inject({ method: "GET", url: "/api/v1/public/resource/GatedPage" });
      expect(tooBroad.statusCode).toBe(400);
      expect(tooBroad.json().error.code).toBe("LIST_TOO_BROAD");
      const narrowed = await app.inject({
        method: "GET",
        url: `/api/v1/public/resource/GatedPage?filters=${encodeURIComponent(JSON.stringify([["status", "=", "published"]]))}`,
      });
      expect(narrowed.statusCode).toBe(200);
      expect(narrowed.json().meta.total).toBe(2);
    } finally {
      limits.LIST_GATED_MAX_ROWS = before;
    }
  });

  it("re-checks rows carrying only the fields the read condition reads, and answers the page whole", async () => {
    const find = vi.spyOn(db, "find");
    try {
      const res = await app.inject({ method: "GET", url: "/api/v1/public/resource/GatedPage?page_size=1&order_by=title%20asc" });
      expect(res.statusCode).toBe(200);
      const scans = find.mock.calls.filter(([name, options]) => name === "GatedPage" && !(options as { limit?: number }).limit);
      const scanned = (scans[0]?.[1] as { fields?: string[] } | undefined)?.fields;
      expect(scanned).toContain("status");
      expect(scanned).not.toContain("title");
      const row = (res.json() as { data: Array<Record<string, unknown>> }).data[0]!;
      expect(row["_id"]).toBe("G-1");
      expect(row["title"]).toBe("G-1");
    } finally {
      find.mockRestore();
    }
  });
});

describe("projectFields answers what a MongoDB projection answers", () => {
  const cases: string[][] = [
    ["title"], ["meta"], ["meta.a"], ["meta.b.c"], ["meta.missing"], ["items.q"], ["items.q", "items.r"],
    ["missing"], ["when"], ["when.x"], ["title", "meta.b"], ["nested"], ["nested.x"], ["nested.x", "nested.y"],
    ["__proto__"], ["__proto__.polluted"],
  ];
  for (const fields of cases) {
    it(`matches the database for ${JSON.stringify(fields)}`, async () => {
      const [stored] = await db.find("GatedPage", { filters: [{ _id: "G-1" }] }, DB);
      const [projected] = await db.find("GatedPage", { filters: [{ _id: "G-1" }], fields }, DB);
      expect(projectFields(stored as Record<string, unknown>, fields)).toEqual(projected);
    });
  }

  it("never touches a prototype, whatever the stored row names", async () => {
    const [stored] = await db.find("GatedPage", { filters: [{ _id: "G-1" }] }, DB);
    const projected = projectFields(stored as Record<string, unknown>, ["__proto__", "__proto__.polluted"].slice(0, 1));
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
