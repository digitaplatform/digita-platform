import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// An app whose settings record would not pass its own save is not set up: the engine refuses every
// create in the app's databases and says so in /boot. The env mock is
// link-targets-boot-and-reload.integration.test.ts's, with the reference seeds loaded at boot.
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
    APP_DIRS: [] as string[], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
    SEED_APP_DATA_ON_BOOT: true, SEED_DEMO_DATA_ON_BOOT: false,
    PASSWORD_FIELD_KEYS: `k1=${Buffer.alloc(32, 7).toString("base64")}`, PASSWORD_FIELD_ACTIVE_KEY_ID: "k1",
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

import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import { readBundle } from "@digitaplatform/shared/i18n-node";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import { removeFirstRunFlagOnce } from "../src/core/setup/seed-system-settings.js";
import { buildTestAuth } from "./_test-auth.js";

const texts = readBundle(process.env["TRANSLATIONS_DIR"]!);
const ADMINISTRATOR = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };
const ADMIN_USER = { _id: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] };

/**
 * A seeded settings row: no street, no hourly rate, no gateway key, two rate rows without their
 * rate, and an IBAN its pattern refuses.
 */
const INCOMPLETE = {
  _id: "shop", company_name: "Shop", rates: [{ valid_from: "2024-01-01" }, { valid_from: "2025-01-01" }], iban: "not an iban",
};
/** What a person saves to complete it. */
const COMPLETION = {
  street: "Main Street 1", hourly_rate: 120, gateway_key: "typed by a person", iban: null,
  rates: [{ valid_from: "2024-01-01", rate: 8.1 }, { valid_from: "2025-01-01", rate: 8.1 }],
};

const dirs: string[] = [];
let replSet: MongoMemoryReplSet;

const writeJson = (path: string, data: unknown) => writeFile(path, JSON.stringify(data), "utf-8");

/**
 * An app `name` of a settings record and an Order, in its own database `<name>_shop`;
 * `seededSettings` is its reference seed, if it has one.
 */
async function writeApp(name: string, seededSettings?: object): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "setup-state-"));
  dirs.push(base);
  const root = join(base, name);
  const database = `${name}_shop`;
  await mkdir(join(root, "shop", "entities"), { recursive: true });
  await writeJson(join(root, "shop", "entities", "shop-setting.entity.json"), {
    name: "ShopSetting", module: "shop", database, is_single: true, naming: { strategy: "user_set" },
    fields: [
      { fieldname: "company_name", fieldtype: "Data", label: "Company name", required: true },
      { fieldname: "street", fieldtype: "Data", label: "Street", required: true },
      { fieldname: "hourly_rate", fieldtype: "Currency", label: "Hourly rate", required: true },
      {
        fieldname: "rates", fieldtype: "Table", label: "Rates", required: true,
        child_fields: [
          { fieldname: "valid_from", fieldtype: "Date", label: "Valid from", required: true },
          { fieldname: "rate", fieldtype: "Percent", label: "Rate", required: true },
        ],
      },
      { fieldname: "iban", fieldtype: "Data", label: "IBAN", regex: "^CH[0-9]{19}$" },
      // A read hides a Password; the setup state must count its stored value all the same.
      { fieldname: "gateway_key", fieldtype: "Password", label: "Gateway key", required: true },
      { fieldname: "note", fieldtype: "Data", label: "Note" },
    ],
    permissions: [ADMINISTRATOR, { role: "Clerk", level: 0, select: 1, read: 1 }],
  });
  await writeJson(join(root, "shop", "entities", "order.entity.json"), {
    name: "Order", module: "shop", database, naming: { strategy: "system" },
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", required: true }],
    permissions: [ADMINISTRATOR, { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1 }],
  });
  if (seededSettings) {
    await mkdir(join(root, "shop", "seeds"), { recursive: true });
    await writeJson(join(root, "shop", "seeds", "ShopSetting.seed.json"), [seededSettings]);
  }
  return root;
}

/** A running engine over the app `name`, and the calls of an administrator and of a clerk against it. */
async function startApp(name: string, seededSettings?: object) {
  (env as { APP_DIRS: string[] }).APP_DIRS = [await writeApp(name, seededSettings)];
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  await result.startup();
  await result.app.ready();
  const bearer = async (roles: string[], language?: string) => ({
    authorization: `Bearer ${await ta.sign({ sub: roles[0]!, email: `${roles[0]!.toLowerCase()}@digita.local`, roles, language })}`,
  });
  return {
    db: result.db,
    database: `${name}_shop`,
    admin: await bearer(["Administrator", "System User"]),
    clerk: await bearer(["Clerk", "System User"]),
    bearer,
    documentService: result.hookRunner.getServices()!.documentService as DocumentService,
    hookRunner: result.hookRunner,
    boot: async (headers?: Record<string, string>) =>
      (await result.app.inject({ method: "GET", url: "/api/v1/boot", headers })).json().data,
    create: (doctype: string, payload: object, headers: Record<string, string>) =>
      result.app.inject({ method: "POST", url: `/api/v1/resource/${doctype}`, headers, payload }),
    save: (doctype: string, name: string, payload: object, headers: Record<string, string>) =>
      result.app.inject({ method: "PUT", url: `/api/v1/resource/${doctype}/${name}`, headers, payload }),
    close: async () => {
      await result.app.close();
      await result.db.disconnect();
    },
  };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
}, 60000);

afterAll(async () => {
  await replSet?.stop();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("an app whose seeded settings record passes its own save", () => {
  let running: Awaited<ReturnType<typeof startApp>>;
  let client: MongoClient;
  const settings = () => client.db(env.MONGODB_CORE_DB).collection<{ _id: string }>(DIGITA.COLLECTIONS.SETTING);

  beforeAll(async () => {
    // The core database of an engine before the first-run flag was removed: its seeded settings row carries it.
    client = await MongoClient.connect(replSet.getUri());
    const now = new Date();
    await settings().insertOne({
      _id: "settings", doctype: "settings", docstatus: 0, default_language: "en", fallback_language: "en",
      allow_user_language: true, platform_name: "Digita Platform", timezone: "UTC", is_first_run: true,
      owner: "system", modified_by: "system", creation: now, modified: now,
    } as never);
    running = await startApp("digita-setup-complete", { ...INCOMPLETE, ...COMPLETION });
  }, 60000);

  afterAll(async () => {
    await running.close();
    await client.close();
  });

  it("is set up from its first start, as a showcase with its demo company is", async () => {
    expect((await running.boot(running.admin)).setup).toEqual({ complete: true, records: [] });
    expect((await running.create("Order", { title: "New" }, running.clerk)).statusCode).toBe(201);
  });

  it("no longer gets the first-run flag in /boot, which nothing read", async () => {
    expect((await running.boot(running.admin)).system_settings).not.toHaveProperty("is_first_run");
  });

  it("has lost the stored first-run flag with that start, once per database", async () => {
    expect(await settings().findOne({ _id: "settings" })).not.toHaveProperty("is_first_run");

    // A value that appears afterwards is not this migration's to remove.
    await settings().updateOne({ _id: "settings" }, { $set: { is_first_run: true } });
    try {
      await removeFirstRunFlagOnce(running.db);
      expect(await settings().findOne({ _id: "settings" })).toHaveProperty("is_first_run", true);
    } finally {
      await settings().updateOne({ _id: "settings" }, { $unset: { is_first_run: "" } });
    }
  });
});

describe("an app whose seeded settings record would not pass its own save", () => {
  let running: Awaited<ReturnType<typeof startApp>>;

  beforeAll(async () => {
    running = await startApp("digita-setup-incomplete", INCOMPLETE);
    // A record from before: a person created it while the app was set up, or a seed brought it.
    const now = new Date();
    await running.db.insertOne(
      "Order",
      { _id: "ORD-1", doctype: "Order", docstatus: 0, title: "Before", owner: "system", modified_by: "system", creation: now, modified: now },
      running.database,
    );
  }, 60000);

  afterAll(async () => {
    await running.close();
  });

  it("tells a user who may write the record every field its save would refuse", async () => {
    expect((await running.boot(running.admin)).setup).toEqual({
      complete: false,
      records: [{ entity: "ShopSetting", fields: ["street", "hourly_rate", "rates", "iban", "gateway_key"], missing_record: false }],
    });
  });

  it("tells a user who may not write the record only that the setup is not complete", async () => {
    expect((await running.boot(running.clerk)).setup).toEqual({ complete: false, records: [] });
  });

  it("tells an anonymous caller nothing", async () => {
    expect((await running.boot()).setup).toBeNull();
  });

  it("refuses a create in the app's database, in the caller's language", async () => {
    const res = await running.create("Order", { title: "New" }, running.clerk);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("SETUP_INCOMPLETE");
    expect(texts.en!["setup_incomplete"]).toBeTruthy();
    expect(res.json().messages).toEqual([{ text: texts.en!["setup_incomplete"], type: "error", show: true }]);

    const german = await running.create("Order", { title: "Neu" }, await running.bearer(["Clerk", "System User"], "de"));
    expect(german.json().messages[0].text).toBe(texts.de!["setup_incomplete"]);
    expect(await running.db.count("Order", [], running.database)).toBe(1);
  });

  it("refuses the create of a hook or a rule too, which call the document service", async () => {
    await expect(running.documentService.insert("Order", { title: "From a hook" }, ADMIN_USER)).rejects.toMatchObject({
      code: "setup_incomplete",
      status: 409,
    });
  });

  it("leaves a record that exists changeable", async () => {
    const res = await running.save("Order", "ORD-1", { title: "Changed" }, running.clerk);
    expect(res.statusCode).toBe(200);
    expect((await running.db.findOne("Order", "ORD-1", running.database))?.["title"]).toBe("Changed");
  });

  it("creates a record outside the app's databases as before", async () => {
    const res = await running.create("Role", { name: "Apprentice", label: "Apprentice" }, running.admin);
    expect(res.statusCode).toBe(201);
  });

  it("keeps refusing after a save of the settings record that leaves a field open", async () => {
    const res = await running.save("ShopSetting", "shop", { note: "half done" }, running.admin);
    expect(res.statusCode).toBe(400);
    expect((await running.create("Order", { title: "New" }, running.clerk)).statusCode).toBe(409);
  });

  it("is set up once the settings record is saved complete, and creates again", async () => {
    expect((await running.save("ShopSetting", "shop", COMPLETION, running.admin)).statusCode).toBe(200);
    expect((await running.boot(running.admin)).setup).toEqual({ complete: true, records: [] });
    expect((await running.boot(running.clerk)).setup).toEqual({ complete: true, records: [] });
    expect((await running.create("Order", { title: "New" }, running.clerk)).statusCode).toBe(201);
  });

  it("never counts a settings record of the core database", async () => {
    // Setting requires default_language; its row without one would not pass its save either.
    const settings = running.db.collection(DIGITA.COLLECTIONS.SETTING, DIGITA.DATABASES.CORE);
    await settings.updateOne({ _id: "settings" as never }, { $unset: { default_language: "" } });
    try {
      expect((await running.boot(running.admin)).setup).toEqual({ complete: true, records: [] });
      expect((await running.create("Order", { title: "Another" }, running.clerk)).statusCode).toBe(201);
    } finally {
      await settings.updateOne({ _id: "settings" as never }, { $set: { default_language: "en" } });
    }
  });
});

describe("an app whose settings record does not exist", () => {
  let running: Awaited<ReturnType<typeof startApp>>;

  beforeAll(async () => {
    running = await startApp("digita-setup-missing");
  }, 60000);

  afterAll(async () => {
    await running.close();
  });

  it("is not set up, and says that the record is missing", async () => {
    expect((await running.boot(running.admin)).setup).toEqual({
      complete: false,
      records: [{ entity: "ShopSetting", fields: ["company_name", "street", "hourly_rate", "rates", "gateway_key"], missing_record: true }],
    });
    expect((await running.create("Order", { title: "New" }, running.admin)).statusCode).toBe(409);
  });

  it("takes the settings record itself, whose create completes the setup", async () => {
    const res = await running.create("ShopSetting", { _id: "shop", company_name: "Shop", ...COMPLETION }, running.admin);
    expect(res.statusCode).toBe(201);
    expect((await running.boot(running.admin)).setup).toEqual({ complete: true, records: [] });
    expect((await running.create("Order", { title: "New" }, running.admin)).statusCode).toBe(201);
  });
});

describe("a save that completes the settings record and creates records through its hook", () => {
  let running: Awaited<ReturnType<typeof startApp>>;
  /** The engine's hooks of an entity, by event: a test plants the hook an app would declare. */
  const hooksOf = () => (running.hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks;

  beforeAll(async () => {
    running = await startApp("digita-setup-by-hook", INCOMPLETE);
  }, 60000);

  afterAll(async () => {
    hooksOf().delete("ShopSetting");
    await running.close();
  });

  it("PLANTED DEFECT: lets the records its on_update hook inserts through, and completes the setup", async () => {
    hooksOf().set("ShopSetting", new Map([["on_update", async (_doc: unknown, _ctx: unknown, services: { session?: never }) => {
      await running.documentService.insert("Order", { title: "Opening order" }, ADMIN_USER, undefined, services.session);
    }]]));
    const res = await running.save("ShopSetting", "shop", COMPLETION, running.admin);
    expect(res.statusCode).toBe(200);
    expect((await running.db.find("Order", {}, running.database)).map((o) => o["title"])).toEqual(["Opening order"]);
    expect((await running.boot(running.admin)).setup).toEqual({ complete: true, records: [] });
  });
});
