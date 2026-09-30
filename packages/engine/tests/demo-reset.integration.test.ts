import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// The env mock of site-scope.integration.test.ts, with the demo tenant setting and both seed
// tiers. One mocked module serves both boots below: each sets DEMO_TENANT before it boots.
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
    SEED_APP_DATA_ON_BOOT: true, SEED_DEMO_DATA_ON_BOOT: true,
    DEMO_TENANT: false,
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
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";

// A workshop-shaped fixture app: one domain folder, a reference row in `seeds/` and a demo row
// in `seeds-demo/`. Domain entities land in `<app dir basename>_<domain>`.
const APP_BASENAME = "digita-demo-reset-fixture";
const DB = `${APP_BASENAME}_operations`;
const RUN_DIR = mkdtempSync(join(tmpdir(), `${APP_BASENAME}-`));
const RESET = "/api/v1/resource/DemoReset/demo-reset/action/reset";

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}

async function writeFixture(): Promise<string> {
  const domain = join(RUN_DIR, APP_BASENAME, "operations");
  const permissions = [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }];
  await writeJson(join(domain, "entities", "WorkshopSetting.entity.json"), {
    name: "WorkshopSetting", module: "workshop", database: DB, is_single: true, naming: { strategy: "user_set" },
    fields: [{ fieldname: "hourly_rate", fieldtype: "Int", label: "Hourly rate" }],
    permissions,
  });
  await writeJson(join(domain, "entities", "WorkOrder.entity.json"), {
    name: "WorkOrder", module: "workshop", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "customer", fieldtype: "Data", label: "Customer", required: true }],
    permissions,
  });
  await writeJson(join(domain, "seeds", "WorkshopSetting.seed.json"), [{ _id: "workshop", hourly_rate: 120 }]);
  await writeJson(join(domain, "seeds-demo", "WorkOrder.seed.json"), [{ _id: "WO-1", customer: "Anna Muster" }]);
  return join(RUN_DIR, APP_BASENAME);
}

let replSet: MongoMemoryReplSet;
let fixtureRoot: string;
const booted: { app: FastifyInstance; db: MongoDBService }[] = [];

async function boot(demoTenant: boolean): Promise<{
  app: FastifyInstance;
  db: MongoDBService;
  registry: EntityRegistry;
  admin: Record<string, string>;
  member: Record<string, string>;
}> {
  (env as { DEMO_TENANT: boolean }).DEMO_TENANT = demoTenant;
  (env as { APP_DIRS: string[] }).APP_DIRS = [fixtureRoot];
  const { authn, sign } = await buildTestAuth();
  const { app, db, startup, registry } = await createApp({ authn });
  await startup();
  await app.ready();
  booted.push({ app, db });
  const bearer = async (roles: string[]) => ({
    authorization: `Bearer ${await sign({ sub: "u@test", email: "u@test", roles })}`,
  });
  return { app, db, registry, admin: await bearer(["Administrator"]), member: await bearer(["System User"]) };
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
  await rm(RUN_DIR, { recursive: true, force: true });
  await replSet.stop();
}, 30000);

describe("the demo reset on a demo tenant", () => {
  let app: FastifyInstance;
  let admin: Record<string, string>;
  let member: Record<string, string>;

  beforeAll(async () => {
    ({ app, admin, member } = await boot(true));
  }, 60000);

  it("is a task of the Jobs page: a single with a long-running action", async () => {
    const meta = await app.inject({ method: "GET", url: "/api/v1/meta/DemoReset", headers: admin });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().data).toMatchObject({ is_single: true, actions: [{ action: "reset", long_running: true }] });
    // The Jobs page resolves the document a job of a single runs on.
    const single = await app.inject({ method: "GET", url: "/api/v1/resource/DemoReset/single", headers: admin });
    expect(single.statusCode).toBe(200);
    expect(single.json().data._id).toBe("demo-reset");
  });

  it("gives a changed demo document its seeded values back and drops a visitor's document", async () => {
    const changed = await app.inject({
      method: "PUT", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin, payload: { customer: "A visitor" },
    });
    expect(changed.statusCode).toBe(200);
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/WorkOrder", headers: admin, payload: { customer: "Another visitor" },
    });
    expect(created.statusCode).toBe(201);
    const visitorOrder = created.json().data._id as string;

    const reset = await app.inject({ method: "POST", url: RESET, headers: admin, payload: {} });
    expect(reset.statusCode).toBe(200);
    // The action answers the chunk protocol, so a job run records the reseed's summary.
    expect(reset.json().data.result).toMatchObject({ done: true, result: { mode: "demo", app_databases_wiped: [DB] } });

    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.json().data.customer).toBe("Anna Muster");
    const gone = await app.inject({ method: "GET", url: `/api/v1/resource/WorkOrder/${visitorOrder}`, headers: admin });
    expect(gone.statusCode).toBe(404);
    const setting = await app.inject({ method: "GET", url: "/api/v1/resource/WorkshopSetting/workshop", headers: admin });
    expect(setting.json().data.hourly_rate).toBe(120);
  });

  it("refuses a caller who is no Administrator and leaves the data as it is", async () => {
    await app.inject({ method: "PUT", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin, payload: { customer: "Kept" } });
    const reset = await app.inject({ method: "POST", url: RESET, headers: member, payload: {} });
    expect(reset.statusCode).toBe(403);
    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.json().data.customer).toBe("Kept");
  });
});

describe("the demo reset on a tenant that is no demo", () => {
  let app: FastifyInstance;
  let db: MongoDBService;
  let registry: EntityRegistry;
  let admin: Record<string, string>;

  // The same database the demo boot above stored the entity in: the case of a tenant whose
  // demo setting was switched off.
  beforeAll(async () => {
    ({ app, db, registry, admin } = await boot(false));
  }, 60000);

  it("does not exist, and a call answers as for any unknown entity", async () => {
    expect(registry.has("DemoReset")).toBe(false);
    const meta = await app.inject({ method: "GET", url: "/api/v1/meta/DemoReset", headers: admin });
    expect(meta.statusCode).toBe(404);
    const reset = await app.inject({ method: "POST", url: RESET, headers: admin, payload: {} });
    const unknown = await app.inject({ method: "POST", url: "/api/v1/resource/NoSuchEntity/x/action/reset", headers: admin, payload: {} });
    expect(reset.statusCode).toBe(unknown.statusCode);
    expect(reset.json().error?.code).toBe(unknown.json().error?.code);
  });

  it("removes the definition and the row the demo boot stored", async () => {
    expect(await db.findOne(DIGITA.COLLECTIONS.ENTITY, "DemoReset", DIGITA.DATABASES.CORE)).toBeNull();
    expect(await db.listCollections(DIGITA.DATABASES.CORE)).not.toContain("DemoReset");
  });

  it("leaves the app's data as it is", async () => {
    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.json().data.customer).toBe("Kept");
  });
});
