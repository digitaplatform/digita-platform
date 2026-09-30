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
    // Its entities grant Guest read, so start-up needs the renderer's purge route; nothing listens there.
    REVALIDATE_URL: "http://127.0.0.1:9/api/revalidate", REVALIDATE_SECRET: "test-revalidate-secret",
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
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// A Guest row with `fields` opens those fields and no other: in the answer, in a filter, a sort
// and a search, in a Table's children and in a link's title. The cost fields of a public
// product stay private, and no query learns them by bisection.
// The engine names an app's database after its folder and module.
let DB: string;
const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };
const PUBLISHED = "eval:doc.status=='published'";
const PRODUCT_FIELDS = ["title", "slug", "description", "images", "brand", "category"];
let fixtureRoot: string;

const entity = (name: string, fields: unknown[], guest: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name, module: "shop", database: DB, naming: { strategy: "user_set" }, title_field: "name", fields,
    permissions: [ADMIN, { role: "Guest", level: 0, select: 1, read: 1, ...guest }], ...extra,
  });

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = await mkdtemp(join(tmpdir(), "digita-public-fields-fixture-"));
  DB = `${basename(fixtureRoot)}_shop`;
  const entities = join(fixtureRoot, "shop", "entities");
  await mkdir(entities, { recursive: true });
  await writeFile(join(entities, "product.entity.json"), entity("Product", [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "slug", fieldtype: "Data", label: "Slug" },
    { fieldname: "status", fieldtype: "Data", label: "Status" },
    { fieldname: "sku", fieldtype: "Data", label: "SKU" },
    { fieldname: "description", fieldtype: "Text", label: "Description" },
    { fieldname: "valuation_rate", fieldtype: "Currency", label: "Valuation Rate" },
    { fieldname: "brand", fieldtype: "Link", label: "Brand", target: "Brand" },
    { fieldname: "category", fieldtype: "Link", label: "Category", target: "Category" },
    { fieldname: "images", fieldtype: "Table", label: "Images", child_fields: [
      { fieldname: "image", fieldtype: "Data", label: "Image" },
      { fieldname: "caption", fieldtype: "Data", label: "Caption" },
    ] },
    { fieldname: "suppliers", fieldtype: "Table", label: "Suppliers", child_fields: [
      { fieldname: "supplier", fieldtype: "Data", label: "Supplier" },
      { fieldname: "cost", fieldtype: "Currency", label: "Cost" },
    ] },
  ], { condition: PUBLISHED, fields: PRODUCT_FIELDS }, { title_field: "title", search_fields: ["title", "sku"] }), "utf-8");
  // A brand's name is not public, a category's is: a link title shows only what the target's row opens.
  const named = [
    { fieldname: "name", fieldtype: "Data", label: "Name" },
    { fieldname: "slug", fieldtype: "Data", label: "Slug" },
  ];
  await writeFile(join(entities, "brand.entity.json"), entity("Brand", named, { fields: ["slug"] }), "utf-8");
  await writeFile(join(entities, "category.entity.json"), entity("Category", named, { fields: ["name", "slug"] }), "utf-8");
  // A website engine scopes a page by its `site` link, which the page's Guest row does not list.
  await writeFile(join(entities, "website.entity.json"), entity("WebSite", [
    { fieldname: "site_name", fieldtype: "Data", label: "Site Name" },
  ], { fields: ["site_name"] }, { title_field: "site_name" }), "utf-8");
  await writeFile(join(entities, "webpage.entity.json"), entity("WebPage", [
    { fieldname: "site", fieldtype: "Link", label: "Site", target: "WebSite" },
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Data", label: "Status" },
  ], { condition: PUBLISHED, fields: ["title"] }, { title_field: "title" }), "utf-8");
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];

  const { authn } = await buildTestAuth();
  const booted = await createApp({ authn });
  app = booted.app;
  db = booted.db;
  await booted.startup();
  await app.ready();

  const now = new Date();
  const stamp = { docstatus: 0, owner: "clerk@shop.test", modified_by: "clerk@shop.test", creation: now, modified: now };
  await db.insertOne("Brand", { doctype: "Brand", _id: "B-1", name: "Brand One", slug: "brand-one", ...stamp }, DB);
  await db.insertOne("Category", { doctype: "Category", _id: "C-1", name: "Bikes", slug: "bikes", ...stamp }, DB);
  const product = (_id: string, title: string, status: string, valuation_rate: number) => ({
    doctype: "Product", _id, title, slug: _id.toLowerCase(), status, sku: `SKU-${_id}`, description: `About ${title}`,
    valuation_rate, brand: "B-1", category: "C-1",
    images: [{ _row_id: `${_id}-r1`, idx: 1, image: `/img/${_id}.png`, caption: title }],
    suppliers: [{ _row_id: `${_id}-s1`, idx: 1, supplier: "Wholesale AG", cost: valuation_rate }],
    ...stamp,
  });
  await db.insertOne("Product", product("P-1", "City Bike", "published", 410), DB);
  await db.insertOne("Product", product("P-2", "Road Bike", "published", 980), DB);
  await db.insertOne("Product", product("P-3", "Prototype Bike", "draft", 1500), DB);
  for (const [site, name] of [["S-1", "Site One"], ["S-2", "Site Two"]]) {
    await db.insertOne("WebSite", { doctype: "WebSite", _id: site, site_name: name, ...stamp }, DB);
  }
  const page = (_id: string, site: string, status: string) => ({ doctype: "WebPage", _id, site, title: `Page ${_id}`, status, ...stamp });
  await db.insertOne("WebPage", page("W-1", "S-1", "published"), DB);
  await db.insertOne("WebPage", page("W-2", "S-2", "published"), DB);
  await db.insertOne("WebPage", page("W-3", "S-1", "draft"), DB);
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await rm(fixtureRoot, { recursive: true, force: true });
  await replSet.stop();
}, 30000);

const get = (url: string) => app.inject({ method: "GET", url });
const listUrl = (query: Record<string, unknown>) =>
  `/api/v1/public/resource/Product?${new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  )}`;
const EXPECTED_KEYS = ["_id", "creation", "docstatus", "doctype", "modified", ...PRODUCT_FIELDS].sort();
const dataKeys = (row: Record<string, unknown>) => Object.keys(row).filter((k) => k !== "_link_titles").sort();

describe("A Guest row with fields opens exactly those fields", () => {
  it("answers a read of one product with the listed fields and the identity fields", async () => {
    const res = await get("/api/v1/public/resource/Product/P-1");
    expect(res.statusCode).toBe(200);
    const row = res.json().data as Record<string, unknown>;
    expect(dataKeys(row)).toEqual(EXPECTED_KEYS);
    expect(row["images"]).toEqual([{ _row_id: "P-1-r1", idx: 1, image: "/img/P-1.png", caption: "City Bike" }]);
  });

  it("answers the list with the listed fields on every published row, and no draft", async () => {
    const res = await get(listUrl({}));
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows.map((r) => r["_id"]).sort()).toEqual(["P-1", "P-2"]);
    for (const row of rows) expect(dataKeys(row)).toEqual(EXPECTED_KEYS);
  });

  it("answers the list's asked fields cut to the listed ones", async () => {
    const res = await get(listUrl({ fields: ["_id", "title", "valuation_rate", "suppliers"] }));
    expect(res.statusCode).toBe(200);
    for (const row of res.json().data as Array<Record<string, unknown>>) expect(dataKeys(row)).toEqual(["_id", "title"]);
  });

  it("refuses a filter, an or_filter and a sort on a field outside the list with 400", async () => {
    for (const query of [
      { filters: [["valuation_rate", ">", 500]] },
      { or_filters: [["valuation_rate", ">", 500]] },
      { order_by: "valuation_rate desc" },
      { filters: [["suppliers.cost", ">", 500]] },
      { filters: [["sku", "=", "SKU-P-2"]] },
      { filters: [["owner", "like", "clerk%"]] },
    ]) {
      const res = await get(listUrl(query));
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
    }
  });

  it("filters and sorts on a listed field", async () => {
    const filtered = await get(listUrl({ filters: [["title", "=", "Road Bike"]] }));
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json().data as Array<Record<string, unknown>>).map((r) => r["_id"])).toEqual(["P-2"]);
    const sorted = await get(listUrl({ order_by: "title desc" }));
    expect(sorted.statusCode).toBe(200);
    expect((sorted.json().data as Array<Record<string, unknown>>).map((r) => r["_id"])).toEqual(["P-2", "P-1"]);
  });

  it("searches the listed search fields only", async () => {
    const bySku = await get(listUrl({ search: "SKU-P-2" }));
    expect(bySku.statusCode).toBe(200);
    expect(bySku.json().data).toEqual([]);
    const byTitle = await get(listUrl({ search: "Road" }));
    expect((byTitle.json().data as Array<Record<string, unknown>>).map((r) => r["_id"])).toEqual(["P-2"]);
  });

  it("shows a link's title only where the target's Guest row opens it", async () => {
    const row = (await get("/api/v1/public/resource/Product/P-1")).json().data as Record<string, unknown>;
    const titles = (row["_link_titles"] ?? {}) as Record<string, unknown>;
    expect(titles["category"]).toBe("Bikes");
    expect(titles).not.toHaveProperty("brand");
    const brand = (await get("/api/v1/public/resource/Brand/B-1")).json().data as Record<string, unknown>;
    expect(dataKeys(brand)).toEqual(["_id", "creation", "docstatus", "doctype", "modified", "slug"]);
  });
});

describe("A website engine with a Guest row that does not list site", () => {
  it("serves its own site's published rows, reads another site's as not found, and refuses a caller's site filter", async () => {
    (env as { SITE_ID: string }).SITE_ID = "S-1";
    try {
      const list = await get("/api/v1/public/resource/WebPage");
      expect(list.statusCode, list.body).toBe(200);
      const rows = list.json().data as Array<Record<string, unknown>>;
      expect(rows.map((r) => r["_id"])).toEqual(["W-1"]);
      expect(rows[0]).not.toHaveProperty("site");
      expect(list.json().meta.total).toBe(1);
      expect((await get("/api/v1/public/resource/WebPage/W-1")).statusCode).toBe(200);
      expect((await get("/api/v1/public/resource/WebPage/W-2")).statusCode).toBe(404);
      expect((await get("/api/v1/public/resource/WebSite/S-1")).statusCode).toBe(200);
      expect((await get("/api/v1/public/resource/WebSite/S-2")).statusCode).toBe(404);
      const bySite = await get(`/api/v1/public/resource/WebPage?${new URLSearchParams({ filters: JSON.stringify([["site", "=", "S-2"]]) })}`);
      expect(bySite.statusCode).toBe(400);
    } finally {
      (env as { SITE_ID: string }).SITE_ID = "";
    }
  });
});
