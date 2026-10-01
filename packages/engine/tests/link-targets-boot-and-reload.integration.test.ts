import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// A Link whose target no entity file loaded stops the boot, and stops a reload of the definitions
// before it replaces anything. The env mock is side-panel-read-gate.integration.test.ts's, with the
// fixture app set per test.
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

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";

const DB = "digita-link-targets-fixture_library";
const ADMIN = { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };
const MISTYPED = 'Book.author links to "Autor", which no loaded entity has';

let replSet: MongoMemoryReplSet;
const dirs: string[] = [];

const writeJson = (path: string, data: unknown) => writeFile(path, JSON.stringify(data), "utf-8");

/** An app of two entities: a Book whose `author` Link names `authorTarget`, and an Author. */
async function writeBook(root: string, authorTarget: string): Promise<void> {
  await writeJson(join(root, "library", "entities", "book.entity.json"), {
    name: "Book", module: "library", database: DB, naming: { strategy: "system" },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "author", fieldtype: "Link", label: "Author", target: authorTarget },
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
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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

describe("POST /admin/reload-definitions of an app whose Link names no loaded entity", () => {
  it("answers the entity, the field and the target and replaces no stored definition", async () => {
    const root = await writeApp("Author");
    (env as { APP_DIRS: string[] }).APP_DIRS = [root];
    const ta = await buildTestAuth();
    const result = await createApp({ authn: ta.authn });
    try {
      await result.startup();
      await result.app.ready();
      const bearer = { authorization: `Bearer ${await ta.sign({ sub: "a", email: "admin@digita.local", roles: ["Administrator", "System User"] })}` };
      const reload = () => result.app.inject({ method: "POST", url: "/api/v1/admin/reload-definitions", headers: bearer });
      const storedTarget = async () => {
        const stored = await result.db.findOne(DIGITA.COLLECTIONS.ENTITY, "Book", DIGITA.DATABASES.CORE);
        return (stored?.["fields"] as Array<{ fieldname: string; target?: string }>).find((f) => f.fieldname === "author")?.target;
      };

      // Innocent: the files as they stand reload.
      expect((await reload()).statusCode).toBe(200);
      expect(await storedTarget()).toBe("Author");

      // Planted: the same file with its target mistyped.
      await writeBook(root, "Autor");
      const refused = await reload();
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.detail).toContain(MISTYPED);
      expect(await storedTarget()).toBe("Author");
    } finally {
      await result.app.close();
      await result.db.disconnect();
    }
  }, 120000);
});
