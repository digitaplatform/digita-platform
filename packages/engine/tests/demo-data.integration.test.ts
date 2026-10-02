// The demo data of an app: an Administrator loads, resets and removes it inside the app, and a
// showcase resets it every night. Each describe boots its own engines on emptied databases.
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// tiers. One mocked module serves every boot below: each sets its own settings before it boots.
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
    APP_DIRS: [] as string[], SITE_ID: "", ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true,
    SEED_APP_DATA_ON_BOOT: true, SEED_DEMO_DATA_ON_BOOT: true,
    DEMO_TENANT: false, APP_NAME: "workshop",
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
import { MongoClient } from "mongodb";
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

// A workshop-shaped fixture app: one domain folder with a settings single and a numbered record.
// The reference tier sets the hourly rate and the country; the demo tier lays a demo company on
// the settings and seeds one work order. Domain entities land in `<app dir basename>_<domain>`.
const APP_BASENAME = "digita-demo-data-fixture";
const DB = `${APP_BASENAME}_operations`;
const RUN_DIR = mkdtempSync(join(tmpdir(), `${APP_BASENAME}-`));
const ACTION = (action: string) => `/api/v1/resource/DemoData/demo-data/action/${action}`;
const STATE = "/api/v1/demo-data";
const DEMO_COMPANY = { company_name: "Veloluck GmbH", street: "Speichenweg 12", qr_iban: "CH4431999123000889012" };

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(data), "utf-8");
}

/** The fixture app; `withDemoTier: false` leaves out its `seeds-demo/` folder. */
async function writeFixture(name: string, withDemoTier: boolean): Promise<string> {
  const domain = join(RUN_DIR, name, APP_BASENAME, "operations");
  const permissions = [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }];
  await writeJson(join(domain, "entities", "WorkshopSetting.entity.json"), {
    name: "WorkshopSetting", module: "workshop", database: DB, is_single: true, naming: { strategy: "user_set" },
    fields: [
      { fieldname: "company_name", fieldtype: "Data", label: "Company name", required: true },
      { fieldname: "street", fieldtype: "Data", label: "Street" },
      { fieldname: "qr_iban", fieldtype: "Data", label: "QR-IBAN" },
      { fieldname: "country", fieldtype: "Data", label: "Country" },
      { fieldname: "hourly_rate", fieldtype: "Int", label: "Hourly rate" },
    ],
    permissions,
  });
  await writeJson(join(domain, "entities", "WorkOrder.entity.json"), {
    name: "WorkOrder", module: "workshop", label: "Work order", database: DB,
    naming: { strategy: "auto_increment", prefix: "WO-", pad_length: 5 },
    fields: [{ fieldname: "customer", fieldtype: "Data", label: "Customer", required: true }],
    permissions,
  });
  await writeJson(join(domain, "seeds", "WorkshopSetting.seed.json"), [{ _id: "workshop", hourly_rate: 100, country: "CH" }]);
  if (withDemoTier) {
    await writeJson(join(domain, "seeds-demo", "WorkshopSetting.seed.json"), [
      { _id: "workshop", ...DEMO_COMPANY, country: "CH", hourly_rate: 120 },
    ]);
    await writeJson(join(domain, "seeds-demo", "WorkOrder.seed.json"), [{ _id: "WO-00001", customer: "Anna Muster" }]);
  }
  return join(RUN_DIR, name, APP_BASENAME);
}

let replSet: MongoMemoryReplSet;
let withDemoTier: string;
let withoutDemoTier: string;
const booted: { app: FastifyInstance; db: MongoDBService }[] = [];

interface Boot {
  app: FastifyInstance;
  db: MongoDBService;
  registry: EntityRegistry;
  admin: Record<string, string>;
  member: Record<string, string>;
}

/** One engine on the shared database, with the settings each case needs. */
async function boot(settings: { demoTenant?: boolean; siteId?: string; seedDemo?: boolean; appName?: string; appDir?: string }): Promise<Boot> {
  Object.assign(env, {
    DEMO_TENANT: settings.demoTenant ?? false,
    SITE_ID: settings.siteId ?? "",
    SEED_DEMO_DATA_ON_BOOT: settings.seedDemo ?? true,
    APP_NAME: settings.appName ?? "workshop",
    APP_DIRS: [settings.appDir ?? withDemoTier],
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

/** Every database of the replica set dropped, so a describe starts from nothing. */
async function dropAll(): Promise<void> {
  const client = await MongoClient.connect(replSet.getUri());
  const { databases } = await client.db().admin().listDatabases();
  for (const { name } of databases) if (!["admin", "local", "config"].includes(name)) await client.db(name).dropDatabase();
  await client.close();
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  withDemoTier = await writeFixture("with-demo", true);
  withoutDemoTier = await writeFixture("without-demo", false);
}, 60000);

afterAll(async () => {
  for (const { app, db } of booted) {
    await app.close();
    await db.disconnect();
  }
  await rm(RUN_DIR, { recursive: true, force: true });
  await replSet.stop();
}, 30000);

const get = async ({ app, admin }: Boot, url: string) => app.inject({ method: "GET", url, headers: admin });
const run = async ({ app, admin }: Boot, action: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: ACTION(action), headers: admin, payload });
const state = async (engine: Boot) => (await get(engine, STATE)).json().data;
const setting = async (engine: Boot) => (await get(engine, "/api/v1/resource/WorkshopSetting/workshop")).json().data;

describe("the demo data of a tenant whose Manager ticked it", () => {
  let engine: Boot;

  beforeAll(async () => {
    await dropAll();
    engine = await boot({});
  }, 60000);

  it("is loaded by the first boot into the empty app, which stamps the load", async () => {
    const now = await state(engine);
    expect(now).toMatchObject({ kind: "tenant", app_name: "workshop", loaded: true, loaded_by: "boot", removed_at: null });
    expect(now.operations).toEqual(["reset", "remove"]);
    expect(now.changes).toEqual({ created: [], changed: [] });
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00001")).json().data.customer).toBe("Anna Muster");
    expect(await setting(engine)).toMatchObject({ ...DEMO_COMPANY, hourly_rate: 120 });
  });

  it("refuses a load while the demo data is loaded", async () => {
    const load = await run(engine, "load");
    expect([load.statusCode, load.json().error?.code]).toEqual([409, "ACTION_NOT_AVAILABLE"]);
  });

  it("refuses a reset without the app's id, with another id, and for a caller who is no Administrator", async () => {
    for (const payload of [{}, { app_id: "garage" }]) {
      const reset = await run(engine, "reset", payload);
      expect([reset.statusCode, reset.json().error?.code]).toEqual([400, "DEMO_DATA_APP_ID"]);
    }
    const member = await engine.app.inject({ method: "POST", url: ACTION("reset"), headers: engine.member, payload: { app_id: "workshop" } });
    expect(member.statusCode).toBe(403);
    expect((await get(engine, STATE)).json().data.loaded_by).toBe("boot");
  });

  it("refuses the state to a caller who is no Administrator", async () => {
    const res = await engine.app.inject({ method: "GET", url: STATE, headers: engine.member });
    expect(res.statusCode).toBe(403);
  });

  it("keeps its stamps when an Administrator saves the record", async () => {
    const before = await state(engine);
    await engine.app.inject({
      method: "PUT", url: "/api/v1/resource/DemoData/demo-data", headers: engine.admin,
      payload: { loaded_at: "2020-01-01T00:00:00.000Z", loaded_by: "someone", removed_at: "2030-01-01T00:00:00.000Z", removed_by: "someone" },
    });
    expect(await state(engine)).toMatchObject({ loaded_by: "boot", loaded_at: before.loaded_at, removed_at: null, loaded: true });
  });

  it("counts the records created and changed since the load", async () => {
    await engine.app.inject({ method: "PUT", url: "/api/v1/resource/WorkOrder/WO-00001", headers: engine.admin, payload: { customer: "Changed" } });
    const created = await engine.app.inject({ method: "POST", url: "/api/v1/resource/WorkOrder", headers: engine.admin, payload: { customer: "Real customer" } });
    expect(created.statusCode).toBe(201);
    expect((await state(engine)).changes).toEqual({
      created: [{ entity: "WorkOrder", label: "Work order", count: 1 }],
      changed: [{ entity: "WorkOrder", label: "Work order", count: 1 }],
    });
  });

  it("resets: gives the demo records back, drops the created one, and keeps the settings as they stand", async () => {
    await engine.app.inject({ method: "PUT", url: "/api/v1/resource/WorkshopSetting/workshop", headers: engine.admin, payload: { hourly_rate: 95 } });
    const reset = await run(engine, "reset", { app_id: "workshop" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.result.result).toMatchObject({ operation: "reset", configuration_kept: ["WorkshopSetting"] });
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00001")).json().data.customer).toBe("Anna Muster");
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00002")).statusCode).toBe(404);
    expect(await setting(engine)).toMatchObject({ ...DEMO_COMPANY, hourly_rate: 95 });
    expect(await state(engine)).toMatchObject({ loaded: true, loaded_by: "admin@test", changes: { created: [], changed: [] } });
  });

  it("names the settings fields a remove sets back, without the one a person set", async () => {
    expect((await state(engine)).fields_restored_by_remove).toEqual([
      { entity: "WorkshopSetting", field: "company_name", label: "Company name" },
      { entity: "WorkshopSetting", field: "street", label: "Street" },
      { entity: "WorkshopSetting", field: "qr_iban", label: "QR-IBAN" },
    ]);
  });

  it("removes: empties the demo company, keeps the person's rate, asks for the setup, and leaves nothing of a wiped record to its id", async () => {
    const { db } = engine;
    // What other databases hold of the demo work order, and of the settings, which stay.
    const of = (entity: string, document_name: string) => ({ entity, document_name });
    await db.insertOne("DocShare", { _id: "share-1", ...of("WorkOrder", "WO-00001"), shared_with: "member@test", can_read: 1 }, DIGITA.DATABASES.IDENTITY);
    await db.insertOne("_versions", { _id: "v-1", ...of("WorkOrder", "WO-00001"), changes: [] }, DIGITA.DATABASES.AUDITS);
    await db.insertOne("_versions", { _id: "v-2", ...of("WorkshopSetting", "workshop"), changes: [] }, DIGITA.DATABASES.AUDITS);
    await db.insertOne("Log", { _id: "log-1", ...of("WorkOrder", "WO-00001"), action: "update" }, DIGITA.DATABASES.LOGS);
    await db.insertOne("_view_logs", { _id: "view-1", ...of("WorkOrder", "WO-00001"), user: "member@test" }, DIGITA.DATABASES.LOGS);
    await db.insertOne("File", { _id: "file-1", file_name: "a.pdf", file_url: "/x", attached_to_entity: "WorkOrder", attached_to_name: "WO-00001" }, DIGITA.DATABASES.CORE);
    await db.insertOne("Translation", { _id: "tr-1", namespace: "data", locale: "de", key: "WorkOrder.WO-00001.customer", value: "x", ...of("WorkOrder", "WO-00001") }, DIGITA.DATABASES.CORE);

    const remove = await run(engine, "remove", { app_id: "workshop" });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().data.result.result.fields_restored).toEqual([
      { entity: "WorkshopSetting", field: "company_name" },
      { entity: "WorkshopSetting", field: "street" },
      { entity: "WorkshopSetting", field: "qr_iban" },
    ]);
    expect(await setting(engine)).toMatchObject({ company_name: null, street: null, qr_iban: null, country: "CH", hourly_rate: 95 });
    expect(await state(engine)).toMatchObject({ loaded: false, removed_by: "admin@test", operations: ["load"], setup_complete: false, changes: null });
    const refused = await engine.app.inject({ method: "POST", url: "/api/v1/resource/WorkOrder", headers: engine.admin, payload: { customer: "First" } });
    expect(refused.json().error?.code).toBe("SETUP_INCOMPLETE");

    await engine.app.inject({ method: "PUT", url: "/api/v1/resource/WorkshopSetting/workshop", headers: engine.admin, payload: { company_name: "Own GmbH" } });
    const first = await engine.app.inject({ method: "POST", url: "/api/v1/resource/WorkOrder", headers: engine.admin, payload: { customer: "First" } });
    expect(first.json().data._id).toBe("WO-00001");
    expect(await db.findOne("DocShare", "share-1", DIGITA.DATABASES.IDENTITY)).toBeNull();
    expect(await db.findOne("_versions", "v-1", DIGITA.DATABASES.AUDITS)).toBeNull();
    expect(await db.findOne("Log", "log-1", DIGITA.DATABASES.LOGS)).toBeNull();
    expect(await db.findOne("_view_logs", "view-1", DIGITA.DATABASES.LOGS)).toBeNull();
    expect(await db.findOne("File", "file-1", DIGITA.DATABASES.CORE)).toBeNull();
    expect(await db.findOne("Translation", "tr-1", DIGITA.DATABASES.CORE)).toBeNull();
    // PLANTED INNOCENT: the settings record is kept, and so is its history.
    expect(await db.findOne("_versions", "v-2", DIGITA.DATABASES.AUDITS)).not.toBeNull();
  });

  it("refuses a load while a record nobody seeded exists, and names its entity", async () => {
    expect((await state(engine)).records_without_seed).toEqual([{ entity: "WorkOrder", label: "Work order", count: 1 }]);
    const load = await run(engine, "load");
    expect([load.statusCode, load.json().error?.code]).toEqual([409, "DEMO_DATA_RECORDS_EXIST"]);
  });

  it("is not loaded again by a boot after the removal", async () => {
    const before = await state(engine);
    engine = await boot({});
    expect(await state(engine)).toMatchObject({ loaded: false, removed_at: before.removed_at, loaded_at: before.loaded_at });
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00001")).json().data.customer).toBe("First");
  });

  it("loads the demo data once nobody's record is left, and keeps the company the person entered", async () => {
    await engine.app.inject({ method: "DELETE", url: "/api/v1/resource/WorkOrder/WO-00001", headers: engine.admin });
    const load = await run(engine, "load");
    expect(load.statusCode).toBe(200);
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00001")).json().data.customer).toBe("Anna Muster");
    expect(await setting(engine)).toMatchObject({ company_name: "Own GmbH", street: null, hourly_rate: 95 });
    expect(await state(engine)).toMatchObject({ loaded: true, loaded_by: "admin@test", operations: ["reset", "remove"] });
  });
});

describe("the demo data of a tenant whose setup is not complete", () => {
  let engine: Boot;

  beforeAll(async () => {
    await dropAll();
    engine = await boot({ seedDemo: false });
  }, 60000);

  it("is not loaded without the box, and refuses a load until the setup is complete", async () => {
    expect(await state(engine)).toMatchObject({ loaded: false, loaded_at: null, operations: ["load"], setup_complete: false });
    const load = await run(engine, "load");
    expect([load.statusCode, load.json().error?.code]).toEqual([409, "SETUP_INCOMPLETE"]);
  });
});

describe("the demo data of a working app whose box is ticked later", () => {
  let engine: Boot;

  beforeAll(async () => {
    await dropAll();
    await boot({ seedDemo: false });
    // A record a person created: it carries no seed hash.
    const first = booted[booted.length - 1]!.db;
    await first.insertOne("WorkOrder", { _id: "WO-00007", doctype: "WorkOrder", docstatus: 0, customer: "Real" }, DB);
    engine = await boot({ seedDemo: true });
  }, 60000);

  it("is not loaded between the app's own records, and offers only a load that is refused", async () => {
    expect((await get(engine, "/api/v1/resource/WorkOrder/WO-00001")).statusCode).toBe(404);
    expect(await state(engine)).toMatchObject({
      loaded: false,
      loaded_at: null,
      operations: ["load"],
      records_without_seed: [{ entity: "WorkOrder", label: "Work order", count: 1 }],
    });
  });
});

describe("the demo data of a showcase", () => {
  let engine: Boot;

  beforeAll(async () => {
    await dropAll();
    engine = await boot({ demoTenant: true });
  }, 60000);

  it("carries only a reset, a task of the Jobs page that takes the app's id as a param", async () => {
    const meta = (await get(engine, "/api/v1/meta/DemoData")).json().data;
    expect(meta.actions).toHaveLength(1);
    expect(meta.actions[0]).toMatchObject({ action: "reset", long_running: true, params: [{ name: "app_id" }] });
    expect(meta.actions[0].show_if).toBeUndefined();
    expect((await state(engine)).operations).toEqual(["reset"]);
  });

  it("refuses a run without the app's id", async () => {
    const reset = await run(engine, "reset");
    expect([reset.statusCode, reset.json().error?.code]).toEqual([400, "DEMO_DATA_APP_ID"]);
  });

  it("resets everything, the settings included, as a job's run does", async () => {
    await engine.app.inject({ method: "PUT", url: "/api/v1/resource/WorkshopSetting/workshop", headers: engine.admin, payload: { hourly_rate: 95 } });
    const visitor = await engine.app.inject({ method: "POST", url: "/api/v1/resource/WorkOrder", headers: engine.admin, payload: { customer: "Visitor" } });
    expect(visitor.statusCode).toBe(201);
    const reset = await run(engine, "reset", { app_id: "workshop" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.result).toMatchObject({ done: true, result: { operation: "reset", configuration_kept: [] } });
    expect((await setting(engine)).hourly_rate).toBe(120);
    expect((await get(engine, `/api/v1/resource/WorkOrder/${visitor.json().data._id}`)).statusCode).toBe(404);
  });
});

describe("the demo data where it does not exist", () => {
  it("is not offered by an engine without an app id: a load, but no reset or remove", async () => {
    await dropAll();
    const engine = await boot({ appName: "", seedDemo: false });
    expect((await state(engine)).operations).toEqual(["load"]);
    const meta = (await get(engine, "/api/v1/meta/DemoData")).json().data;
    expect(meta.actions.map((a: { action: string }) => a.action)).toEqual(["load"]);
  });

  it("does not exist on an app engine without a demo tier", async () => {
    await dropAll();
    const engine = await boot({ appDir: withoutDemoTier });
    expect(engine.registry.has("DemoData")).toBe(false);
    expect((await get(engine, STATE)).statusCode).toBe(404);
  });

  it("does not exist on a website engine, and its boot removes what an earlier app engine stored", async () => {
    await dropAll();
    await boot({ demoTenant: true });
    const engine = await boot({ demoTenant: true, siteId: "show" });
    expect(engine.registry.has("DemoData")).toBe(false);
    expect(await engine.db.findOne(DIGITA.COLLECTIONS.ENTITY, "DemoData", DIGITA.DATABASES.CORE)).toBeNull();
    expect(await engine.db.listCollections(DIGITA.DATABASES.CORE)).not.toContain("DemoData");
  });

  it("replaces the demo reset an earlier release stored, and the reseed route is gone", async () => {
    await dropAll();
    const first = await boot({});
    await first.db.insertOne(DIGITA.COLLECTIONS.ENTITY, { _id: "DemoReset", name: "DemoReset", module: "core", database: "core", fields: [] }, DIGITA.DATABASES.CORE);
    await first.db.insertOne("DemoReset", { _id: "demo-reset" }, DIGITA.DATABASES.CORE);
    const engine = await boot({});
    expect(engine.registry.has("DemoReset")).toBe(false);
    expect(await engine.db.listCollections(DIGITA.DATABASES.CORE)).not.toContain("DemoReset");
    const reseed = await engine.app.inject({ method: "POST", url: "/api/v1/admin/reseed", headers: engine.admin, payload: { mode: "demo" } });
    expect(reseed.statusCode).toBe(404);
  });
});
