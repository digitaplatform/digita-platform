import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// A Link whose target no entity file loaded stops the boot, and stops a reload of the definitions
// before it changes what the engine serves or stores. The env mock is
// side-panel-read-gate.integration.test.ts's, with the fixture app set per test.
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

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { seedViewsFromFiles } from "../src/core/view/view-loader.js";
import { buildTestAuth } from "./_test-auth.js";

const DB = "digita-link-targets-fixture_library";
const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };
const MISTYPED = 'Book.author links to "Autor", which no loaded entity has';

let replSet: ReplicaFixture;
const dirs: string[] = [];

const writeJson = (path: string, data: unknown) => writeFile(path, JSON.stringify(data), "utf-8");

/** An app of two entities: a Book whose `author` Link names `authorTarget`, and an Author. */
async function writeBook(root: string, authorTarget: string, extraFields: unknown[] = []): Promise<void> {
  await writeJson(join(root, "library", "entities", "book.entity.json"), {
    name: "Book", module: "library", database: DB, naming: { strategy: "system" },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", translatable: true },
      { fieldname: "author", fieldtype: "Link", label: "Author", target: authorTarget },
      ...extraFields,
    ],
    permissions: [ADMIN],
  });
}

async function writeApp(authorTarget: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "link-targets-"));
  dirs.push(base);
  const root = join(base, "digita-link-targets-fixture");
  await mkdir(join(root, "library", "entities"), { recursive: true });
  await writeJson(join(root, "library", "entities", "author.entity.json"), {
    name: "Author", module: "library", database: DB, naming: { strategy: "system" },
    fields: [{ fieldname: "name", fieldtype: "Data", label: "Name" }],
    permissions: [ADMIN],
  });
  await writeBook(root, authorTarget);
  return root;
}

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
}, 60000);

afterAll(async () => {
  await replSet?.stop();
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe("the boot of an app whose Link names no loaded entity", () => {
  it("fails and names the entity, the field and the target", async () => {
    (env as { APP_DIRS: string[] }).APP_DIRS = [await writeApp("Autor")];
    const result = await createApp({ authn: (await buildTestAuth()).authn });
    try {
      await expect(result.startup()).rejects.toThrow(MISTYPED);
    } finally {
      await result.app.close();
      await result.db.disconnect();
    }
  }, 60000);
});

/** A running app with valid files, and the calls of an administrator against it. */
async function startAdminApp() {
  const root = await writeApp("Author");
  (env as { APP_DIRS: string[] }).APP_DIRS = [root];
  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  await result.startup();
  await result.app.ready();
  const headers = { authorization: `Bearer ${await ta.sign({ sub: "a", email: "admin@digita.local", roles: ["Administrator", "System User"] })}` };
  const authorTargetOf = (fields: Array<{ fieldname: string; target?: string }>) => fields.find((f) => f.fieldname === "author")?.target;
  return {
    root,
    db: result.db,
    inject: (method: "GET" | "POST", url: string, payload?: object) => result.app.inject({ method, url, headers, payload }),
    reload: () => result.app.inject({ method: "POST", url: "/api/v1/admin/reload-definitions", headers }),
    createDefinition: (payload: unknown) => result.app.inject({ method: "POST", url: "/api/v1/meta", headers, payload: payload as object }),
    storedTarget: async () => {
      const stored = await result.db.findOne(DIGITA.COLLECTIONS.ENTITY, "Book", DIGITA.DATABASES.CORE);
      return authorTargetOf(stored?.["fields"] as Array<{ fieldname: string; target?: string }>);
    },
    servedTarget: async () => {
      const served = await result.app.inject({ method: "GET", url: "/api/v1/meta/Book", headers });
      return authorTargetOf(served.json().data.fields);
    },
    close: async () => {
      await result.app.close();
      await result.db.disconnect();
    },
  };
}

describe("POST /admin/reload-definitions", () => {
  let running: Awaited<ReturnType<typeof startAdminApp>>;
  beforeEach(async () => { running = await startAdminApp(); }, 60000);
  afterEach(async () => { await running.close(); });

  it("refuses a newly loaded entity's incompatible storage before changing live or stored metadata", async () => {
    const name = "NativeReloadRefusal";
    const raw = running.db.getDb(DB);
    await raw.createCollection(name, { timeseries: { timeField: "posted_at" } });
    await raw.collection(name).insertOne({ posted_at: new Date(), value: "kept" });
    await writeJson(join(running.root, "library", "entities", "native.entity.json"), {
      name, module: "library", database: DB, naming: { strategy: "system" },
      fields: [{ fieldname: "posted_at", fieldtype: "Datetime", label: "Posted" }],
      permissions: [ADMIN],
    });
    try {
      const refused = await running.reload();
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.detail).toBe("ordinary_collection_required");
      expect((await running.inject("GET", `/api/v1/meta/${name}`)).statusCode).toBe(404);
      expect(await running.db.findOne(DIGITA.COLLECTIONS.ENTITY, name, DIGITA.DATABASES.CORE)).toBeNull();
      expect(await running.storedTarget()).toBe("Author");
      expect(await running.servedTarget()).toBe("Author");
      expect(await raw.collection(name).countDocuments()).toBe(1);
    } finally {
      await raw.dropCollection(name);
    }
  });

  it("answers the entity, the field and the target of a Link no file has and replaces no stored definition", async () => {
    // Innocent: the files as they stand reload.
    expect((await running.reload()).statusCode).toBe(200);
    expect(await running.storedTarget()).toBe("Author");

    // Planted: the same file with its target mistyped.
    await writeBook(running.root, "Autor");
    const refused = await running.reload();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.detail).toBe("definition_refused");
    expect(refused.json().messages[0].text).toContain(MISTYPED);
    expect(await running.storedTarget()).toBe("Author");
  }, 120000);

  it("keeps serving the definition it served before a refused reload", async () => {
    expect(await running.servedTarget()).toBe("Author");

    await writeBook(running.root, "Autor");
    expect((await running.reload()).statusCode).toBe(400);
    expect(await running.servedTarget()).toBe("Author");
  }, 120000);

  it("is not refused for a Link of a definition POST /meta wrote, which boot does not check either", async () => {
    const created = await running.createDefinition({
      name: "Loan", module: "library", database: DB, naming: { strategy: "system" },
      fields: [{ fieldname: "borrower", fieldtype: "Link", label: "Borrower", target: "Nobody" }],
      permissions: [ADMIN],
    });
    expect(created.statusCode).toBe(201);

    expect((await running.reload()).statusCode).toBe(200);
  }, 120000);

  it("answers 400 with the message for a file boot refuses for another defect", async () => {
    await writeBook(running.root, "Author", [{ fieldname: "owner", fieldtype: "Data", label: "Owner" }]);
    const refused = await running.reload();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.detail).toBe("definition_refused");
    expect(refused.json().messages[0].text).toContain('Field "owner" of entity "Book" is named after a system field');
  }, 120000);
});

describe("POST /admin/reload-definitions runs every check boot runs on the definitions", () => {
  let running: Awaited<ReturnType<typeof startAdminApp>>;
  afterEach(async () => {
    await running.close();
    (env as { DEMO_TENANT?: boolean }).DEMO_TENANT = undefined;
  });

  it("refuses a Password field without the key set, and keeps serving what it served", async () => {
    running = await startAdminApp();
    await writeBook(running.root, "Author", [{ fieldname: "pin", fieldtype: "Password", label: "PIN" }]);
    const refused = await running.reload();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.detail).toBe("password_keys_missing_for_field");
    expect(refused.json().messages[0].text).toContain("PASSWORD_FIELD_KEYS");
    expect(await running.servedTarget()).toBe("Author");
  }, 120000);

  it("refuses an entity a visitor can read without the renderer's revalidate settings", async () => {
    running = await startAdminApp();
    await writeJson(join(running.root, "library", "entities", "author.entity.json"), {
      name: "Author", module: "library", database: DB, naming: { strategy: "system" },
      fields: [{ fieldname: "name", fieldtype: "Data", label: "Name" }],
      permissions: [ADMIN, { role: "Guest", level: 0, select: 1, read: 1 }],
    });
    const refused = await running.reload();
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.detail).toBe("setting_missing_for_guest_read");
    expect(refused.json().messages[0].text).toContain("REVALIDATE_URL");
  }, 120000);

  it("reloads a file that links the demo reset on an engine that may reseed, as boot loads it", async () => {
    (env as { DEMO_TENANT?: boolean }).DEMO_TENANT = true;
    running = await startAdminApp();
    await writeBook(running.root, "Author", [{ fieldname: "reset", fieldtype: "Link", label: "Reset", target: "DemoReset" }]);
    expect((await running.reload()).statusCode).toBe(200);
  }, 120000);

  it("keeps marked custom and file-seeded Rule, View, and Translation rows unchanged while refreshing active controls", async () => {
    await mkdir(join(running.root, "rules"), { recursive: true });
    await writeJson(join(running.root, "rules", "retained.rule.json"), {
      _id: "rule-file-retained",
      entity: "Book",
      event: "before_save",
      actions: [{ type: "set_value", field: "title", value: "'Retained Rule Value'" }],
    });

    await mkdir(join(running.root, "views"), { recursive: true });
    await writeJson(join(running.root, "views", "retained.view.json"), {
      _id: "view-file-retained",
      name: "Retained View",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }],
    });
    await writeJson(join(running.root, "views", "active.view.json"), {
      _id: "view-file-active",
      name: "Active View Initial",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }],
    });

    await mkdir(join(running.root, "seeds"), { recursive: true });
    await writeJson(join(running.root, "seeds", "Book.translations.json"), [
      { _id: "retained-book", field: "title", en: "Fresh File Title" },
      { _id: "active-book", field: "title", en: "Active File Title" },
    ]);

    await writeJson(join(running.root, "rules", "active.rule.json"), {
      _id: "rule-file-active", entity: "Book", event: "before_save", condition: "false",
      actions: [{ type: "set_value", field: "title", value: "'Active Rule'" }],
    });

    const deletedAt = new Date("2026-02-01T12:00:00Z");
    const createdAt = new Date("2026-01-01T12:00:00Z");

    const customRule = {
      _id: "rule-custom-retained",
      entity: "Book",
      event: "before_save",
      actions: [{ type: "set_value", field: "title", value: "'Custom Rule Value'" }],
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "admin@digita.local",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
      docstatus: 0,
    };
    const fileRule = {
      _id: "rule-file-retained",
      entity: "Book",
      event: "before_save",
      actions: [{ type: "set_value", field: "title", value: "'Retained Rule Value'" }],
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "system",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
      docstatus: 0,
    };
    await running.db.insertOne(DIGITA.COLLECTIONS.RULE, customRule, DIGITA.DATABASES.CORE);
    await running.db.insertOne(DIGITA.COLLECTIONS.RULE, fileRule, DIGITA.DATABASES.CORE);

    const customView = {
      _id: "view-custom-retained",
      name: "Custom View",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }],
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "admin@digita.local",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
      docstatus: 0,
    };
    const fileView = {
      _id: "view-file-retained",
      name: "Retained View",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }],
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "system",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
      docstatus: 0,
    };
    const activeView = {
      _id: "view-file-active",
      name: "Active View Initial",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }],
      owner: "system",
      modified_by: "system",
      creation: createdAt,
      modified: createdAt,
      docstatus: 0,
    };
    await running.db.insertOne(DIGITA.COLLECTIONS.VIEW, customView, DIGITA.DATABASES.CORE);
    await running.db.insertOne(DIGITA.COLLECTIONS.VIEW, fileView, DIGITA.DATABASES.CORE);
    await running.db.insertOne(DIGITA.COLLECTIONS.VIEW, activeView, DIGITA.DATABASES.CORE);

    const customTranslation = {
      _id: "data:en:Book.custom-book.title",
      namespace: "data",
      locale: "en",
      key: "Book.custom-book.title",
      value: "Custom Translation",
      source: "user",
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "admin@digita.local",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
    };
    const fileTranslation = {
      _id: "data:en:Book.retained-book.title",
      namespace: "data",
      locale: "en",
      key: "Book.retained-book.title",
      value: "Original Stored Title",
      source: "file",
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "system",
      modified_by: "admin@digita.local",
      creation: createdAt,
      modified: createdAt,
    };
    await running.db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, customTranslation, DIGITA.DATABASES.CORE);
    await running.db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, fileTranslation, DIGITA.DATABASES.CORE);

    await writeJson(join(running.root, "views", "active.view.json"), {
      _id: "view-file-active",
      name: "Active View Refreshed",
      anchored: false,
      sections: [{ key: "rows", kind: "list", entity: "Book", limit: 25 }],
    });

    const reloadRes = await running.reload();
    expect(reloadRes.statusCode).toBe(200);

    const storedCustomRule = await running.db.findOne(DIGITA.COLLECTIONS.RULE, "rule-custom-retained", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedCustomRule).toMatchObject(customRule);

    const storedFileRule = await running.db.findOne(DIGITA.COLLECTIONS.RULE, "rule-file-retained", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedFileRule).toMatchObject(fileRule);

    const storedCustomView = await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "view-custom-retained", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedCustomView).toMatchObject(customView);

    const storedFileView = await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "view-file-retained", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedFileView).toMatchObject(fileView);

    const storedCustomTrans = await running.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "data:en:Book.custom-book.title", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedCustomTrans).toMatchObject(customTranslation);

    const storedFileTrans = await running.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "data:en:Book.retained-book.title", DIGITA.DATABASES.CORE, undefined, { includeDeleted: true });
    expect(storedFileTrans).toMatchObject(fileTranslation);

    const storedActiveView = await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "view-file-active", DIGITA.DATABASES.CORE);
    const activeRule = await running.db.findOne(DIGITA.COLLECTIONS.RULE, "rule-file-active", DIGITA.DATABASES.CORE);
    expect(activeRule?.["actions"]).toEqual([{ type: "set_value", field: "title", value: "'Active Rule'" }]);
    const activeTranslation = await running.db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "data:en:Book.active-book.title", DIGITA.DATABASES.CORE);
    expect(activeTranslation?.["value"]).toBe("Active File Title");
    expect(storedActiveView?.["name"]).toBe("Active View Refreshed");
    expect((storedActiveView?.["sections"] as Array<{ limit: number }>)[0]?.limit).toBe(25);
  }, 120000);
});

describe("a View saved through the API", () => {
  let running: Awaited<ReturnType<typeof startAdminApp>>;
  const saved = { _id: "saved-books", name: "Saved books", anchored: false, sections: [{ key: "rows", kind: "list", entity: "Book", limit: 10 }] };

  beforeAll(async () => {
    running = await startAdminApp();
  }, 60000);
  afterAll(async () => {
    await running.close();
  });

  it("PLANTED DEFECT: is kept by a reload of the definitions and still served", async () => {
    expect((await running.inject("POST", "/api/v1/resource/View", saved)).statusCode).toBe(201);
    expect((await running.reload()).statusCode).toBe(200);
    expect(await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "saved-books", DIGITA.DATABASES.CORE)).not.toBeNull();
    expect((await running.inject("GET", "/api/v1/view/saved-books")).statusCode).toBe(200);
  });

  it("is no orphan at the seed of the view files, while a seeded row whose file is gone is pruned", async () => {
    const now = new Date();
    await running.db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { ...saved, _id: "file-gone", owner: "system", modified_by: "system", creation: now, modified: now, docstatus: 0, overridden: false },
      DIGITA.DATABASES.CORE,
    );
    const prune = (env as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS;
    (env as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS = true;
    try {
      const summary = await seedViewsFromFiles(running.db, [running.root]);
      expect(summary).toMatchObject({ orphans_detected: 1, pruned: 1 });
    } finally {
      (env as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS = prune;
    }
    expect(await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "file-gone", DIGITA.DATABASES.CORE)).toBeNull();
    expect(await running.db.findOne(DIGITA.COLLECTIONS.VIEW, "saved-books", DIGITA.DATABASES.CORE)).not.toBeNull();
  });
});
