import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// The env mock of site-scope.integration.test.ts, with the demo tenant setting and both seed
// tiers. One mocked module serves every boot below: each sets its own settings before it boots.
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
    APP_DIRS: [] as string[], SITE_ID: "", ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true,
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

interface Boot {
  app: FastifyInstance;
  db: MongoDBService;
  registry: EntityRegistry;
  admin: Record<string, string>;
  member: Record<string, string>;
}

/** One engine on the shared database: a demo tenant or not, a website engine or not, with or
 *  without the demo tier. */
async function boot(settings: { demoTenant: boolean; siteId?: string; seedDemo?: boolean }): Promise<Boot> {
  Object.assign(env, {
    DEMO_TENANT: settings.demoTenant,
    SITE_ID: settings.siteId ?? "",
    SEED_DEMO_DATA_ON_BOOT: settings.seedDemo ?? true,
    APP_DIRS: [fixtureRoot],
  });
  const { authn, sign } = await buildTestAuth();
  const { app, db, startup, registry } = await createApp({ authn });
  await startup();
  await app.ready();
  booted.push({ app, db });
  const bearer = async (email: string, roles: string[]) => ({
    authorization: `Bearer ${await sign({ sub: email, email, roles })}`,
  });
  return {
    app,
    db,
    registry,
    admin: await bearer("admin@test", ["Administrator"]),
    member: await bearer("member@test", ["System User"]),
  };
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

/** The demo reset is not there: no definition, and a call answers as one on an unknown entity. */
async function expectNoDemoReset({ app, registry, admin }: Boot): Promise<void> {
  expect(registry.has("DemoReset")).toBe(false);
  const meta = await app.inject({ method: "GET", url: "/api/v1/meta/DemoReset", headers: admin });
  expect(meta.statusCode).toBe(404);
  const reset = await app.inject({ method: "POST", url: RESET, headers: admin, payload: {} });
  const unknown = await app.inject({ method: "POST", url: "/api/v1/resource/NoSuchEntity/x/action/reset", headers: admin, payload: {} });
  expect(reset.statusCode).toBe(unknown.statusCode);
  expect(reset.json().error?.code).toBe(unknown.json().error?.code);
}

/** The reseed route's refusal code, or none: a body without a mode is refused after the guards
 *  with INVALID_MODE, so no reseed runs either way. */
async function reseedRouteCode({ app, admin }: Boot): Promise<string | undefined> {
  const res = await app.inject({ method: "POST", url: "/api/v1/admin/reseed", headers: admin, payload: {} });
  return res.json().error?.code;
}

/** What an earlier boot of a demo app engine stored is gone. */
async function expectStoredDemoResetRemoved({ db }: Boot): Promise<void> {
  expect(await db.findOne(DIGITA.COLLECTIONS.ENTITY, "DemoReset", DIGITA.DATABASES.CORE)).toBeNull();
  expect(await db.listCollections(DIGITA.DATABASES.CORE)).not.toContain("DemoReset");
}

// The describes run in order on one database: each boot that removes the entity follows one that
// stored it.
describe("the demo reset on a demo tenant", () => {
  let engine: Boot;

  beforeAll(async () => {
    engine = await boot({ demoTenant: true });
  }, 60000);

  it("is a task of the Jobs page: a single with a long-running action", async () => {
    const { app, admin } = engine;
    const meta = await app.inject({ method: "GET", url: "/api/v1/meta/DemoReset", headers: admin });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().data).toMatchObject({ is_single: true, actions: [{ action: "reset", long_running: true }] });
    // The Jobs page resolves the document a job of a single runs on.
    const single = await app.inject({ method: "GET", url: "/api/v1/resource/DemoReset/single", headers: admin });
    expect(single.statusCode).toBe(200);
    expect(single.json().data._id).toBe("demo-reset");
  });

  it("gives a changed demo document its seeded values back and drops a visitor's document", async () => {
    const { app, admin } = engine;
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
    const { app, admin, member } = engine;
    await app.inject({ method: "PUT", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin, payload: { customer: "Kept" } });
    const reset = await app.inject({ method: "POST", url: RESET, headers: member, payload: {} });
    expect(reset.statusCode).toBe(403);
    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.json().data.customer).toBe("Kept");
  });

  it("lets the reseed route past its guards", async () => {
    expect(await reseedRouteCode(engine)).toBe("INVALID_MODE");
  });

  it("refuses a caller its row is shared with, who may read it but not reset", async () => {
    const { app, admin, member } = engine;
    const share = await app.inject({
      method: "POST", url: "/api/v1/resource/DocShare", headers: admin,
      payload: { entity: "DemoReset", document_name: "demo-reset", shared_with: "member@test", can_read: 1 },
    });
    expect(share.statusCode).toBe(201);
    // The share works: the caller reads the row, which the action route also asks for.
    const row = await app.inject({ method: "GET", url: "/api/v1/resource/DemoReset/demo-reset", headers: member });
    expect(row.statusCode).toBe(200);
    const reset = await app.inject({ method: "POST", url: RESET, headers: member, payload: {} });
    expect(reset.statusCode).toBe(403);
    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.json().data.customer).toBe("Kept");
  });
});

describe("the demo reset on a website engine of a demo tenant", () => {
  let engine: Boot;

  // A reset loads the seed tiers, never the site folder a website engine seeds at boot, so it
  // would leave the site without its pages.
  beforeAll(async () => {
    engine = await boot({ demoTenant: true, siteId: "show" });
  }, 60000);

  it("does not exist, and a call answers as for any unknown entity", async () => {
    await expectNoDemoReset(engine);
  });

  it("removes the definition and the row a demo app engine stored", async () => {
    await expectStoredDemoResetRemoved(engine);
  });

  it("refuses the reseed route too", async () => {
    expect(await reseedRouteCode(engine)).toBe("RESEED_DISABLED");
  });
});

describe("the demo reset of an app that seeds only the reference tier", () => {
  let engine: Boot;

  beforeAll(async () => {
    engine = await boot({ demoTenant: true, seedDemo: false });
  }, 60000);

  it("returns the app to the reference tier alone", async () => {
    const { app, admin } = engine;
    await app.inject({ method: "PUT", url: "/api/v1/resource/WorkshopSetting/workshop", headers: admin, payload: { hourly_rate: 99 } });
    const reset = await app.inject({ method: "POST", url: RESET, headers: admin, payload: {} });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.result).toMatchObject({ done: true, result: { mode: "template" } });
    const setting = await app.inject({ method: "GET", url: "/api/v1/resource/WorkshopSetting/workshop", headers: admin });
    expect(setting.json().data.hourly_rate).toBe(120);
    // The demo tier is not loaded again: its work order is gone with the wipe.
    const order = await app.inject({ method: "GET", url: "/api/v1/resource/WorkOrder/WO-1", headers: admin });
    expect(order.statusCode).toBe(404);
  });
});

describe("the demo reset on a tenant that is no demo", () => {
  let engine: Boot;

  // The database a demo boot above stored the entity in: the case of a tenant whose demo setting
  // was switched off.
  beforeAll(async () => {
    engine = await boot({ demoTenant: false });
  }, 60000);

  it("does not exist, and a call answers as for any unknown entity", async () => {
    await expectNoDemoReset(engine);
  });

  it("removes the definition and the row the demo boot stored", async () => {
    await expectStoredDemoResetRemoved(engine);
  });

  // The test env runs outside production, where the route used to run on every engine.
  it("refuses the reseed route", async () => {
    expect(await reseedRouteCode(engine)).toBe("RESEED_DISABLED");
  });
});
