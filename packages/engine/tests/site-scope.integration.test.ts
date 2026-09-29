import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Same env mock as public-read.integration.test.ts, plus SITE_ID (mutated per
// boot below — one shared mocked module, so a test must finish its HTTP
// assertions before the next one reassigns env.SITE_ID/APP_DIRS for its own boot).
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
import { mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readFile } from "fs/promises";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// Self-contained fixture app (no dependency on a sibling digita-catalog checkout):
// a minimal WebSite/WebPage pair under a "content" domain, with seed folders for
// TWO sites — mirrors the shared catalog bundle every website engine of a tenant
// mounts (hostyour-manager#308): the folder tree carries every site; SITE_ID picks
// which one this boot seeds and serves.
// Domain-loaded entities get their `database` FORCED to `<appDir-basename>_<domain>`
// regardless of what the JSON declares (entity-registry.ts loadEntityFile) — the
// same rule that makes the real WebPage/WebSite/WebNavMenu's declared "web_content"
// line up with app "web" + domain "content". A fixed (not mkdtemp-random) app dir
// name keeps that computed name predictable here too.
const APP_BASENAME = "digita-site-scope-fixture";
const DB = `${APP_BASENAME}_content`;
let fixtureRoot: string;
/** Every WebPage id the fixture's `after_delete` hook saw, one per line. */
const DELETED_MARKER = join(tmpdir(), `${APP_BASENAME}-deleted.txt`);

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}

async function writeFixture(): Promise<string> {
  const appDir = join(tmpdir(), APP_BASENAME);
  await rm(appDir, { recursive: true, force: true });
  const entities = join(appDir, "content", "entities");
  await mkdir(entities, { recursive: true });
  await writeJson(join(entities, "WebSite.entity.json"), {
    name: "WebSite", module: "web", database: DB, naming: { strategy: "user_set" },
    title_field: "site_name",
    fields: [{ fieldname: "site_name", fieldtype: "Data", label: "Site Name", required: true }],
    permissions: [
      { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
      { role: "Guest", level: 0, select: 1, read: 1 },
    ],
  });
  await writeJson(join(entities, "WebPage.entity.json"), {
    name: "WebPage", module: "web", database: DB, naming: { strategy: "user_set" },
    title_field: "title",
    fields: [
      { fieldname: "site", fieldtype: "Link", label: "Site", target: "WebSite", required: true },
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
    ],
    permissions: [
      { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
      { role: "Guest", level: 0, select: 1, read: 1 },
    ],
    hooks: { after_delete: "web/page.afterDelete" },
  });
  // The hook records what it saw, so a boot delete proves that it took the API's path.
  const modules = join(appDir, "content", "modules", "web");
  await mkdir(modules, { recursive: true });
  await writeFile(
    join(modules, "page.ts"),
    `import { appendFileSync } from "fs";\n` +
      `export const afterDelete = (doc: { _id: string }) => appendFileSync(${JSON.stringify(DELETED_MARKER)}, doc._id + "\\n");\n`,
    "utf-8",
  );
  await rm(DELETED_MARKER, { force: true });
  for (const [site, label] of [["site-a", "Site A"], ["site-b", "Site B"]] as const) {
    const dir = join(appDir, "content", "sites", site);
    await writeJson(join(dir, "WebSite.seed.json"), [{ _id: site, site_name: label }]);
    await writeJson(join(dir, "WebPage.seed.json"), [{ _id: `${site}::home`, site, title: `${label} Home` }]);
  }
  return appDir;
}

let replSet: MongoMemoryReplSet;
const booted: { app: FastifyInstance; db: MongoDBService }[] = [];

async function boot(siteId: string): Promise<{ app: FastifyInstance; db: MongoDBService; registry: import("../src/core/entity/entity-registry.js").EntityRegistry }> {
  (env as { SITE_ID: string }).SITE_ID = siteId;
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];
  const { authn } = await buildTestAuth();
  const { app, db, startup, registry } = await createApp({ authn });
  await startup();
  await app.ready();
  booted.push({ app, db });
  return { app, db, registry };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = await writeFixture();
}, 60000);

afterAll(async () => {
  for (const { app, db } of booted) {
    await app.close();
    await db.disconnect();
  }
  await rm(fixtureRoot, { recursive: true, force: true });
  await rm(DELETED_MARKER, { force: true });
  await replSet.stop();
}, 30000);

describe("Per-site website engine (hostyour-manager#308)", () => {
  it("seeds only its own site's folder and serves only its own site", async () => {
    const { app, db } = await boot("site-a");

    // Boot-time seed: this engine's own site landed; the OTHER site's seed
    // folder was never touched by this boot (non-destructive AND not-mine).
    expect(await db.findOne("WebSite", "site-a", DB)).toBeTruthy();
    expect(await db.findOne("WebSite", "site-b", DB)).toBeNull();

    const list = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite" });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["site-a"]);

    const one = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite/site-a" });
    expect(one.statusCode).toBe(200);
    expect(one.json().data.site_name).toBe("Site A");

    const pages = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebPage" });
    expect((pages.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["site-a::home"]);
  });

  it("a second engine with a different SITE_ID seeds and serves only ITS site, sharing the same DB", async () => {
    const { app, db } = await boot("site-b");

    // Non-destructive: site-a's row from the previous boot is untouched...
    expect(await db.findOne("WebSite", "site-a", DB)).toBeTruthy();
    // ...and this boot added its own.
    expect(await db.findOne("WebSite", "site-b", DB)).toBeTruthy();

    // Both sites now physically exist in the shared DB — the public API must
    // still answer only for THIS engine's site.
    const list = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite" });
    expect((list.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["site-b"]);

    // A request naming the OTHER site explicitly finds nothing, even though
    // that row exists in Mongo right now.
    const other = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite/site-a" });
    expect(other.statusCode).toBe(404);
    const otherPage = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebPage/site-a::home" });
    expect(otherPage.statusCode).toBe(404);

    const pages = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebPage" });
    expect((pages.json().data as Array<{ _id: string }>).map((r) => r._id)).toEqual(["site-b::home"]);
  });

  it("an engine without SITE_ID is unchanged — no scoping, sees every site", async () => {
    const { app } = await boot("");

    const list = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite" });
    expect((list.json().data as Array<{ _id: string }>).map((r) => r._id).sort()).toEqual(["site-a", "site-b"]);

    const a = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite/site-a" });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({ method: "GET", url: "/api/v1/public/resource/WebSite/site-b" });
    expect(b.statusCode).toBe(200);
  });

  it("deletes the site's rows the seed no longer carries through the document service, hooks loaded (#67)", async () => {
    // Rows of an earlier catalog: one this loader wrote, one a person changed since.
    const db = booted[0]!.db;
    const stamps = { doctype: "WebPage", docstatus: 0, creation: new Date(), modified: new Date() };
    await db.insertOne("WebPage", { ...stamps, _id: "site-a::stale", site: "site-a", title: "Stale", owner: "system", modified_by: "system" }, DB);
    await db.insertOne("WebPage", { ...stamps, _id: "site-a::mine", site: "site-a", title: "Mine", owner: "system", modified_by: "admin@example.com" }, DB);

    await boot("site-a");

    expect(await db.findOne("WebPage", "site-a::stale", DB)).toBeNull();
    expect(await db.findOne("WebPage", "site-a::mine", DB)).toBeTruthy();
    expect(await db.findOne("WebPage", "site-a::home", DB)).toBeTruthy();
    // The planted defect this test guards: a sweep that runs before the app's hooks are loaded.
    expect(await readFile(DELETED_MARKER, "utf-8")).toBe("site-a::stale\n");
    const logged = await db.find(
      DIGITA.COLLECTIONS.LOG,
      { filters: [{ entity: "WebPage" }, { document_name: "site-a::stale" }, { action: "Deleted" }] },
      DIGITA.DATABASES.LOGS,
    );
    expect(logged.map((row) => row.user)).toEqual(["system"]);
  });
});
