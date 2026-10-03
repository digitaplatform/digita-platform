import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
// A committed write of an entity a visitor can read tells the website renderer to drop its cache.
// The env mock is public-create.integration.test.ts's, on a website engine of site-a, with the
// renderer's purge route pointed at a stand-in renderer this file runs.
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
    APP_DIRS: [] as string[], SITE_ID: "site-a", ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true,
    SEED_APP_DATA_ON_BOOT: false, SEED_DEMO_DATA_ON_BOOT: false,
    // Set by beforeAll once the stand-in renderer listens.
    REVALIDATE_URL: "", REVALIDATE_SECRET: "shared-secret",
  } };
});
const logError = vi.hoisted(() => vi.fn());
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: logError, fatal: vi.fn() }),
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
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

const APP_BASENAME = "digita-revalidate-fixture";
const DB = `${APP_BASENAME}_content`;
const RES = "/api/v1/resource";
const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, import: 1 };
const GUEST_READ = { role: "Guest", level: 0, select: 1, read: 1 };

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}

async function writeFixture(): Promise<string> {
  // A folder of this run alone: two runs on one machine at once would otherwise rewrite and delete
  // each other's app. The app keeps its folder name, which names its database.
  const appDir = join(await mkdtemp(join(tmpdir(), "revalidate-")), APP_BASENAME);
  const entities = join(appDir, "content", "entities");
  await writeJson(join(entities, "WebSite.entity.json"), {
    name: "WebSite", module: "web", database: DB, naming: { strategy: "user_set" }, title_field: "site_name",
    fields: [{ fieldname: "site_name", fieldtype: "Data", label: "Site Name", required: true }],
    permissions: [ADMIN, GUEST_READ],
  });
  await writeJson(join(entities, "WebPage.entity.json"), {
    name: "WebPage", module: "web", database: DB, naming: { strategy: "user_set" },
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    permissions: [ADMIN, GUEST_READ],
  });
  // A copy needs a name the engine makes, which a user_set entity lacks.
  await writeJson(join(entities, "WebBlock.entity.json"), {
    name: "WebBlock", module: "web", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    permissions: [ADMIN, GUEST_READ],
  });
  // Guest may create it, not read it: the renderer never caches it.
  await writeJson(join(entities, "Lead.entity.json"), {
    name: "Lead", module: "web", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "email", fieldtype: "Data", label: "Email" }],
    permissions: [ADMIN, { role: "Guest", level: 0, create: 1, write: 1 }],
  });
  await writeJson(join(appDir, "content", "sites", "site-a", "WebSite.seed.json"), [{ _id: "site-a", site_name: "Site A" }]);
  return appDir;
}

/** What the stand-in renderer received: the secret, the tags, and the page's title in the database
 *  at that moment, which shows whether the post came after the commit. */
type Purge = { secret: string | undefined; tags: string[]; storedTitle: unknown };

let replSet: ReplicaFixture;
let renderer: Server;
let rendererStatus = 200;
/** How long the stand-in renderer takes before it records a purge and answers. */
let rendererDelayMs = 0;
const purges: Purge[] = [];
let app: FastifyInstance;
let db: MongoDBService;
let adminToken: string;
let fixtureRoot: string;
let observedPageId = "p1";

const bearer = () => ({ authorization: `Bearer ${adminToken}` });
/** The purge posts after the commit, so a test waits for it; the limit is far above a busy machine's delay. */
const PURGE_WAIT = { timeout: 20000, interval: 20 };
const purgesAfter = async (count: number): Promise<Purge[]> => {
  await vi.waitFor(() => expect(purges.length).toBeGreaterThanOrEqual(count), PURGE_WAIT);
  return purges.slice(count - 1);
};

beforeAll(async () => {
  renderer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      void new Promise((resolve) => setTimeout(resolve, rendererDelayMs)).then(() => db?.findOne("WebPage", observedPageId, DB)).then((row) => {
        purges.push({
          secret: req.headers["x-revalidate-secret"] as string | undefined,
          tags: (JSON.parse(raw) as { tags: string[] }).tags,
          storedTitle: row?.["title"],
        });
        res.writeHead(rendererStatus, { "content-type": "application/json" }).end("{}");
      });
    });
  });
  await new Promise<void>((resolve) => renderer.listen(0, "127.0.0.1", resolve));
  (env as { REVALIDATE_URL: string }).REVALIDATE_URL = `http://127.0.0.1:${(renderer.address() as AddressInfo).port}/api/revalidate`;

  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  fixtureRoot = await writeFixture();
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
  adminToken = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] });
}, 60000);

afterAll(async () => {
  await app?.close();
  await db?.disconnect();
  await rm(join(fixtureRoot, ".."), { recursive: true, force: true });
  await replSet?.stop();
  await new Promise((resolve) => renderer?.close(resolve));
}, 30000);

describe("the renderer's cache purge", () => {
  it("is posted once at boot, after the site seed, with the tag of every entity Guest may read", () => {
    expect(purges[0]).toMatchObject({ secret: "shared-secret" });
    expect([...purges[0]!.tags].sort()).toEqual(["entity:WebBlock", "entity:WebPage", "entity:WebSite"]);
  });

  it("PLANTED DEFECT: is posted with the entity's tag after a create, an update and a delete commit", async () => {
    let seen = purges.length;
    const created = await app.inject({ method: "POST", url: `${RES}/WebPage`, headers: bearer(), payload: { _id: "p1", title: "Draft" } });
    expect(created.statusCode).toBe(201);
    expect(await purgesAfter(++seen)).toEqual([{ secret: "shared-secret", tags: ["entity:WebPage"], storedTitle: "Draft" }]);

    const updated = await app.inject({ method: "PUT", url: `${RES}/WebPage/p1`, headers: bearer(), payload: { title: "Published" } });
    expect(updated.statusCode).toBe(200);
    expect(await purgesAfter(++seen)).toEqual([{ secret: "shared-secret", tags: ["entity:WebPage"], storedTitle: "Published" }]);

    const deleted = await app.inject({ method: "DELETE", url: `${RES}/WebPage/p1`, headers: bearer() });
    expect(deleted.statusCode).toBe(200);
    expect(await purgesAfter(++seen)).toEqual([{ secret: "shared-secret", tags: ["entity:WebPage"], storedTitle: undefined }]);
  });

  it("is posted with the entity's tag after a copy and an import commit", async () => {
    let seen = purges.length;
    const created = await app.inject({ method: "POST", url: `${RES}/WebBlock`, headers: bearer(), payload: { title: "Source" } });
    expect(created.statusCode).toBe(201);
    await purgesAfter(++seen);
    const source = (JSON.parse(created.body) as { data: { _id: string } }).data._id;

    const copied = await app.inject({ method: "POST", url: `${RES}/WebBlock/${source}/copy`, headers: bearer() });
    expect(copied.statusCode).toBe(201);
    expect((await purgesAfter(++seen))[0]!.tags).toEqual(["entity:WebBlock"]);

    observedPageId = "p-import";
    try {
      const imported = await app.inject({
        method: "POST", url: "/api/v1/import/WebPage", headers: bearer(),
        payload: { mode: "insert", rows: [{ _id: observedPageId, title: "Imported" }] },
      });
      expect(imported.statusCode).toBe(200);
      expect(imported.json().data).toMatchObject({ inserted: 1, failed: 0 });
      expect(await purgesAfter(++seen)).toEqual([{ secret: "shared-secret", tags: ["entity:WebPage"], storedTitle: "Imported" }]);
      const deleted = await app.inject({ method: "DELETE", url: `${RES}/WebPage/${observedPageId}`, headers: bearer() });
      expect(deleted.statusCode).toBe(200);
      await purgesAfter(++seen);
    } finally {
      observedPageId = "p1";
    }
  });

  it("PLANTED INNOCENT: is not posted for an import that only validates", async () => {
    const seen = purges.length;
    const validated = await app.inject({
      method: "POST", url: "/api/v1/import/WebPage", headers: bearer(),
      payload: { mode: "validate", rows: [{ _id: "p9", title: "Checked" }] },
    });
    expect(validated.statusCode).toBe(200);
    // A save of a readable entity afterwards is the first post the renderer sees.
    await app.inject({ method: "PUT", url: `${RES}/WebSite/site-a`, headers: bearer(), payload: { site_name: "Site A1" } });
    expect((await purgesAfter(seen + 1))[0]!.tags).toEqual(["entity:WebSite"]);
  });

  it("PLANTED INNOCENT: is not posted for a save of an entity Guest may not read", async () => {
    const seen = purges.length;
    const created = await app.inject({ method: "POST", url: `${RES}/Lead`, headers: bearer(), payload: { email: "a@example.com" } });
    expect(created.statusCode).toBe(201);
    // A save of a readable entity afterwards is the first post the renderer sees.
    await app.inject({ method: "PUT", url: `${RES}/WebSite/site-a`, headers: bearer(), payload: { site_name: "Site A2" } });
    expect((await purgesAfter(seen + 1))[0]!.tags).toEqual(["entity:WebSite"]);
  });

  it("PLANTED DEFECT: is waited for when the renderer answers slower than vitest's default wait", async () => {
    rendererDelayMs = 1500;
    try {
      const seen = purges.length;
      const updated = await app.inject({ method: "PUT", url: `${RES}/WebSite/site-a`, headers: bearer(), payload: { site_name: "Site A slow" } });
      expect(updated.statusCode).toBe(200);
      expect((await purgesAfter(seen + 1))[0]!.tags).toEqual(["entity:WebSite"]);
    } finally {
      rendererDelayMs = 0;
    }
  });

  it("refused by the renderer, is logged, and the save still answers 200", async () => {
    rendererStatus = 401;
    try {
      const seen = purges.length;
      const updated = await app.inject({ method: "PUT", url: `${RES}/WebSite/site-a`, headers: bearer(), payload: { site_name: "Site A3" } });
      expect(updated.statusCode).toBe(200);
      await purgesAfter(seen + 1);
      await vi.waitFor(
        () => expect(logError).toHaveBeenCalledWith({ entities: ["WebSite"], status: 401 }, "Renderer refused the cache purge"),
        PURGE_WAIT,
      );
    } finally {
      rendererStatus = 200;
    }
  });
});

describe("a website engine's start-up", () => {
  it("fails and names REVALIDATE_URL when an entity grants Guest read and the setting is missing", async () => {
    const url = env.REVALIDATE_URL;
    (env as { REVALIDATE_URL: string }).REVALIDATE_URL = "";
    try {
      const result = await createApp({ authn: (await buildTestAuth()).authn });
      try {
        await expect(result.startup()).rejects.toMatchObject({
          code: "setting_missing_for_guest_read",
          params: { setting: "REVALIDATE_URL", doctype: expect.stringMatching(/^(WebSite|WebPage|WebBlock)$/) },
        });
      } finally {
        await result.app.close();
        await result.db.disconnect();
      }
    } finally {
      (env as { REVALIDATE_URL: string }).REVALIDATE_URL = url;
    }
  }, 60000);
});
