import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

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
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
    AUTO_MIGRATE: true,
    PASSWORD_FIELD_KEYS: "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", PASSWORD_FIELD_ACTIVE_KEY_ID: "k1",
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
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { HookRunner } from "../src/core/hooks/hook-runner.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SchemaMigrator } from "../src/core/database/schema-migrator.js";
import { encryptPassword, decryptPassword, isEncryptedPassword } from "../src/core/entity/password-cipher.js";

// A Password value must not rest in MongoDB as it was sent: whoever reads the
// database, a backup or a dump would read it.
const vault = {
  name: "Vault",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "V-", pad_length: 4 },
  is_submittable: false,
  track_changes: true,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
    { fieldname: "secret", fieldtype: "Password", label: "Secret", idx: 2 },
    {
      fieldname: "accounts", fieldtype: "Table", label: "Accounts", idx: 3,
      child_fields: [
        { fieldname: "host", fieldtype: "Data", label: "Host", idx: 1 },
        { fieldname: "password", fieldtype: "Password", label: "Password", idx: 2 },
      ],
    },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
  ],
} as unknown as EntityDefinition;

// The same fields on a submittable entity, so a document can be cancelled and amended.
const sealedVault = {
  ...vault,
  name: "SealedVault",
  naming: { strategy: "auto_increment", prefix: "SV-", pad_length: 4 },
  is_submittable: true,
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
  ],
} as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let hookRunner: HookRunner;
let registry: { register: (entity: EntityDefinition) => void };
let authToken: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  hookRunner = result.hookRunner;
  await result.startup();
  await app.ready();
  registry = result.registry;
  result.registry.register(vault);
  await db.ensureCollection("Vault", "app");
  result.registry.register(sealedVault);
  await db.ensureCollection("SealedVault", "app");

  authToken = await ta.sign({
    sub: "admin@digita.local",
    email: "admin@digita.local",
    roles: ["Administrator", "System User"],
  });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

function authHeaders() {
  return { authorization: `Bearer ${authToken}` };
}

const clear = decryptPassword;
let vaultId: string;

describe("a Password value at rest", () => {
  it("is not the value as sent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/Vault",
      headers: authHeaders(),
      payload: { title: "Mail server", secret: "s3cret-value", accounts: [{ host: "smtp", password: "row-secret" }] },
    });
    expect(res.statusCode).toBe(201);
    vaultId = res.json().data._id;
    const raw = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    expect(raw["title"]).toBe("Mail server");
    expect(raw["secret"]).toBeTruthy();
    expect(raw["secret"]).not.toBe("s3cret-value");
  });

  it("is AES-256-GCM under the active key id and decrypts through the hook runtime", async () => {
    const raw = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    expect(isEncryptedPassword(raw["secret"])).toBe(true);
    expect((raw["secret"] as { key_id: string }).key_id).toBe("k1");
    expect(hookRunner.getServices()!.decryptPassword(raw["secret"])).toBe("s3cret-value");
  });

  it("is encrypted inside a Table row too", async () => {
    const raw = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    const row = (raw["accounts"] as Record<string, unknown>[])[0]!;
    expect(row["host"]).toBe("smtp");
    expect(row["password"]).not.toBe("row-secret");
    expect(clear(row["password"])).toBe("row-secret");
  });

  it("stays when a save omits it and when a Table row comes back as read", async () => {
    const before = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/Vault/${vaultId}`, headers: authHeaders() });
    expect(read.json().data.secret).toBeUndefined();
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/Vault/${vaultId}`,
      headers: authHeaders(),
      payload: { title: "Mail server 2", accounts: read.json().data.accounts },
    });
    expect(res.statusCode).toBe(200);
    const after = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    expect(after["title"]).toBe("Mail server 2");
    expect(after["secret"]).toEqual(before["secret"]);
    expect(after["accounts"]).toEqual(before["accounts"]);
  });

  it("leaves no clear value in _versions", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/Vault/${vaultId}`,
      headers: authHeaders(),
      payload: { secret: "s3cret-second" },
    });
    expect(res.statusCode).toBe(200);
    const versions = await db.findManyByFilter("_versions", { entity: "Vault", document_name: vaultId }, "audits");
    const secretChanges = versions.flatMap((v) => (v["changes"] as { field: string; old: unknown; new: unknown }[]).filter((c) => c.field === "secret"));
    expect(secretChanges.length).toBeGreaterThan(0);
    expect(JSON.stringify(versions)).not.toContain("s3cret");
    expect(clear(secretChanges[secretChanges.length - 1]!.new)).toBe("s3cret-second");
  });

  it("encrypts new values with a new active key while an old key stays readable", async () => {
    const before = (await db.findOne("Vault", vaultId, "app")) as Record<string, unknown>;
    (env as { PASSWORD_FIELD_KEYS: string }).PASSWORD_FIELD_KEYS += ",k2=YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
    (env as { PASSWORD_FIELD_ACTIVE_KEY_ID: string }).PASSWORD_FIELD_ACTIVE_KEY_ID = "k2";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/Vault",
      headers: authHeaders(),
      payload: { title: "Rotated", secret: "s3cret-rotated" },
    });
    expect(res.statusCode).toBe(201);
    const raw = (await db.findOne("Vault", res.json().data._id, "app")) as Record<string, unknown>;
    expect((raw["secret"] as { key_id: string }).key_id).toBe("k2");
    expect(clear(raw["secret"])).toBe("s3cret-rotated");
    expect(clear(before["secret"])).toBe("s3cret-second");
  });
});

describe("a Password value in the stored form sent by a client", () => {
  const forged = { key_id: "k1", iv: "AAAA", tag: "AAAA", data: "AAAA" };

  it("is refused when the engine never encrypted it", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/resource/Vault", headers: authHeaders(), payload: { title: "Forged", secret: forged } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("field_password_not_as_stored");
    expect(await db.findManyByFilter("Vault", { title: "Forged" }, "app")).toEqual([]);
  });

  it("is refused when it is another record's stored value", async () => {
    const a = await app.inject({ method: "POST", url: "/api/v1/resource/Vault", headers: authHeaders(), payload: { title: "A", accounts: [{ host: "smtp", password: "victim-pw" }] } });
    expect(a.statusCode).toBe(201);
    const readA = await app.inject({ method: "GET", url: `/api/v1/resource/Vault/${a.json().data._id}`, headers: authHeaders() });
    const moved = readA.json().data.accounts[0].password;
    expect(isEncryptedPassword(moved)).toBe(true);
    const b = await app.inject({ method: "POST", url: "/api/v1/resource/Vault", headers: authHeaders(), payload: { title: "B", secret: moved } });
    expect(b.statusCode).toBe(400);
    const cell = await app.inject({ method: "POST", url: "/api/v1/resource/Vault", headers: authHeaders(), payload: { title: "B", accounts: [{ host: "x", password: moved }] } });
    expect(cell.statusCode).toBe(400);
    const put = await app.inject({ method: "PUT", url: `/api/v1/resource/Vault/${vaultId}`, headers: authHeaders(), payload: { secret: moved } });
    expect(put.statusCode).toBe(400);
    expect(await db.findManyByFilter("Vault", { title: "B" }, "app")).toEqual([]);
  });
});

describe("a Table Password cell of a copied or amended document", () => {
  const post = (url: string, payload?: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/v1/resource/${url}`, headers: authHeaders(), ...(payload ? { payload } : {}) });
  const storedCell = async (entity: string, id: string): Promise<unknown> =>
    ((await db.findOne(entity, id, "app")) as { accounts: Record<string, unknown>[] }).accounts[0]!["password"];
  const expectCarried = (cell: unknown) => {
    expect(isEncryptedPassword(cell)).toBe(true);
    expect((cell as { key_id: string }).key_id).toBeTruthy();
    expect(clear(cell)).toBe("row-secret");
  };

  it("is carried into the copy in its encrypted form", async () => {
    const source = await post("Vault", { title: "To copy", accounts: [{ host: "smtp", password: "row-secret" }] });
    expect(source.statusCode).toBe(201);
    const copy = await post(`Vault/${source.json().data._id}/copy`);
    expect(copy.json()).toEqual(expect.objectContaining({ success: true }));
    expect(copy.statusCode).toBe(201);
    expectCarried(await storedCell("Vault", copy.json().data._id));
  });

  it("is carried into the amendment of a cancelled document in its encrypted form", async () => {
    const source = await post("SealedVault", { title: "To amend", accounts: [{ host: "smtp", password: "row-secret" }] });
    expect(source.statusCode).toBe(201);
    const id = source.json().data._id;
    expect((await post(`SealedVault/${id}/submit`)).statusCode).toBe(200);
    expect((await post(`SealedVault/${id}/cancel`)).statusCode).toBe(200);
    const amended = await post(`SealedVault/${id}/amend`);
    expect(amended.json()).toEqual(expect.objectContaining({ success: true }));
    expect(amended.statusCode).toBe(201);
    expectCarried(await storedCell("SealedVault", amended.json().data._id));
  });

  it("carries a top-level Password value into the copy and the amendment, encrypted anew", async () => {
    const storedSecret = async (entity: string, id: string): Promise<unknown> =>
      ((await db.findOne(entity, id, "app")) as Record<string, unknown>)["secret"];
    const source = await post("Vault", { title: "Top copy", secret: "top-secret" });
    expect(source.statusCode).toBe(201);
    const copy = await post(`Vault/${source.json().data._id}/copy`);
    expect(copy.statusCode).toBe(201);
    const copied = await storedSecret("Vault", copy.json().data._id);
    expect(isEncryptedPassword(copied)).toBe(true);
    expect(clear(copied)).toBe("top-secret");
    expect(copied).not.toEqual(await storedSecret("Vault", source.json().data._id));

    const sealed = await post("SealedVault", { title: "Top amend", secret: "top-secret" });
    const id = sealed.json().data._id;
    expect((await post(`SealedVault/${id}/submit`)).statusCode).toBe(200);
    expect((await post(`SealedVault/${id}/cancel`)).statusCode).toBe(200);
    const amended = await post(`SealedVault/${id}/amend`);
    expect(amended.statusCode).toBe(201);
    expect(clear(await storedSecret("SealedVault", amended.json().data._id))).toBe("top-secret");
  });

  it("encrypts the carried values under the active key, not the source's", async () => {
    const keys = env as { PASSWORD_FIELD_KEYS: string; PASSWORD_FIELD_ACTIVE_KEY_ID: string };
    const before = { list: keys.PASSWORD_FIELD_KEYS, active: keys.PASSWORD_FIELD_ACTIVE_KEY_ID };
    try {
      keys.PASSWORD_FIELD_KEYS = "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=,k2=YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = "k1";
      const source = await post("Vault", { title: "Rotating copy", secret: "top-secret", accounts: [{ host: "smtp", password: "row-secret" }] });
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = "k2";
      const copy = await post(`Vault/${source.json().data._id}/copy`);
      expect(copy.statusCode).toBe(201);
      const stored = (await db.findOne("Vault", copy.json().data._id, "app")) as { secret: { key_id: string }; accounts: { password: { key_id: string } }[] };
      expect(stored.secret.key_id).toBe("k2");
      expect(stored.accounts[0]!.password.key_id).toBe("k2");
      expect(clear(stored.secret)).toBe("top-secret");
    } finally {
      keys.PASSWORD_FIELD_KEYS = before.list;
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = before.active;
    }
  });

  it("judges and carries the same stored row, read once", async () => {
    const source = await post("Vault", { title: "Read once", secret: "first-state" });
    const id = source.json().data._id;
    // A second read of the source during the copy would see a changed secret.
    const original = db.findOne.bind(db);
    let reads = 0;
    const findOne = vi.spyOn(db, "findOne").mockImplementation(async (...args: Parameters<typeof db.findOne>) => {
      const row = await original(...args);
      if (args[0] === "Vault" && args[1] === id && row) {
        reads += 1;
        if (reads > 1) return { ...row, secret: encryptPassword("second-state") };
      }
      return row;
    });
    try {
      const copy = await post(`Vault/${id}/copy`);
      expect(copy.statusCode).toBe(201);
      expect(reads).toBe(1);
      expect(clear(((await original("Vault", copy.json().data._id, "app")) as Record<string, unknown>)["secret"])).toBe("first-state");
    } finally {
      findOne.mockRestore();
    }
  });

  it("answers 409 PASSWORD_KEY_NOT_LISTED when a carried value's key is no longer listed", async () => {
    const keys = env as { PASSWORD_FIELD_KEYS: string; PASSWORD_FIELD_ACTIVE_KEY_ID: string };
    const before = { list: keys.PASSWORD_FIELD_KEYS, active: keys.PASSWORD_FIELD_ACTIVE_KEY_ID };
    try {
      keys.PASSWORD_FIELD_KEYS = "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=,k2=YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = "k1";
      const source = await post("Vault", { title: "Orphaned key", secret: "top-secret" });
      keys.PASSWORD_FIELD_KEYS = "k2=YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = "k2";
      const copy = await post(`Vault/${source.json().data._id}/copy`);
      expect(copy.statusCode).toBe(409);
      expect(copy.json().error.code).toBe("PASSWORD_KEY_NOT_LISTED");
      expect(JSON.stringify(copy.json())).not.toContain("top-secret");
    } finally {
      keys.PASSWORD_FIELD_KEYS = before.list;
      keys.PASSWORD_FIELD_ACTIVE_KEY_ID = before.active;
    }
  });

  it("is still refused when a client sends the source's stored cell in a new document", async () => {
    const source = await post("Vault", { title: "Copied by hand", accounts: [{ host: "smtp", password: "row-secret" }] });
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/Vault/${source.json().data._id}`, headers: authHeaders() });
    const res = await post("Vault", { title: "Copied by hand", accounts: read.json().data.accounts });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("field_password_not_as_stored");
  });
});

describe("a clear Password value stored before this change", () => {
  const migrator = () => new SchemaMigrator(db);

  it("is not overwritten by the migration when a user saves it in between", async () => {
    await db.insertOne("Vault", { _id: "V-7001", title: "Racing", secret: "old-clear" }, "app");
    const read = db.findManyByFilter.bind(db);
    vi.spyOn(db, "findManyByFilter").mockImplementationOnce(async (...args) => {
      const rows = await read(...args);
      const res = await app.inject({ method: "PUT", url: "/api/v1/resource/Vault/V-7001", headers: authHeaders(), payload: { secret: "new-by-user" } });
      expect(res.statusCode).toBe(200);
      return rows;
    });
    await migrator().migrate(vault);
    const raw = (await db.findOne("Vault", "V-7001", "app")) as Record<string, unknown>;
    expect(clear(raw["secret"])).toBe("new-by-user");
  });

  it("moves forward to its encrypted form by the migration, in rows, Table cells and _versions", async () => {
    await db.insertOne("Vault", {
      _id: "V-9001", title: "Old", secret: "old-clear", accounts: [{ _row_id: "r1", host: "imap", password: "old-row-clear" }, { _row_id: "r2", host: "pop", password: null }],
    }, "app");
    await db.insertOne("_versions", {
      _id: "old-version", entity: "Vault", document_name: "V-9001", changed_by: "admin@digita.local", timestamp: new Date(),
      changes: [{ field: "secret", old: null, new: "old-clear" }, { field: "accounts[r1].password", old: "older", new: "old-row-clear" }, { field: "title", old: "a", new: "Old" }],
    }, "audits");

    await migrator().migrate(vault);

    const raw = (await db.findOne("Vault", "V-9001", "app")) as Record<string, unknown>;
    expect(raw["secret"]).not.toBe("old-clear");
    expect(clear(raw["secret"])).toBe("old-clear");
    const rows = raw["accounts"] as Record<string, unknown>[];
    expect(clear(rows[0]!["password"])).toBe("old-row-clear");
    expect(rows[1]!["password"]).toBeNull();
    const version = (await db.findOne("_versions", "old-version", "audits")) as Record<string, unknown>;
    expect(JSON.stringify(version)).not.toContain("old-clear");
    expect(JSON.stringify(version)).not.toContain("older");
    const changes = version["changes"] as { field: string; old: unknown; new: unknown }[];
    expect(changes[0]!.old).toBeNull();
    expect(clear(changes[0]!.new)).toBe("old-clear");
    expect(clear(changes[1]!.old)).toBe("older");
    expect(changes[2]).toEqual({ field: "title", old: "a", new: "Old" });
  });

  it("is left alone by a second run once it carries a key id", async () => {
    const before = await db.findOne("Vault", "V-9001", "app");
    const versionBefore = await db.findOne("_versions", "old-version", "audits");
    await migrator().migrate(vault);
    expect(await db.findOne("Vault", "V-9001", "app")).toEqual(before);
    expect(await db.findOne("_versions", "old-version", "audits")).toEqual(versionBefore);
  });
});

describe("a record with a required Password", () => {
  const requiredVault = {
    ...vault,
    name: "RequiredVault",
    naming: { strategy: "auto_increment", prefix: "RV-", pad_length: 4 },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
      { fieldname: "secret", fieldtype: "Password", label: "Secret", idx: 2, required: true },
      {
        fieldname: "accounts", fieldtype: "Table", label: "Accounts", idx: 3,
        child_fields: [
          { fieldname: "host", fieldtype: "Data", label: "Host", idx: 1 },
          { fieldname: "password", fieldtype: "Password", label: "Password", idx: 2, required: true },
        ],
      },
    ],
  } as unknown as EntityDefinition;
  const put = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/api/v1/resource/RequiredVault/${id}`, headers: authHeaders(), payload });

  beforeAll(async () => {
    registry.register(requiredVault);
    await db.ensureCollection("RequiredVault", "app");
  });

  it("PLANTED DEFECT: saves again without the password, keeps it stored and shows it to no read", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/RequiredVault", headers: authHeaders(),
      payload: { title: "Gateway", secret: "api-key-1", accounts: [{ host: "smtp", password: "row-secret" }] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data._id as string;
    const before = (await db.findOne("RequiredVault", id, "app")) as Record<string, unknown>;

    const again = await put(id, { title: "Gateway 2" });
    expect(again.statusCode).toBe(200);
    const after = (await db.findOne("RequiredVault", id, "app")) as Record<string, unknown>;
    expect([after["title"], after["secret"]]).toEqual(["Gateway 2", before["secret"]]);
    const read = await app.inject({ method: "GET", url: `/api/v1/resource/RequiredVault/${id}`, headers: authHeaders() });
    expect(read.json().data.secret).toBeUndefined();

    // A Table row keeps its stored cells on a read, so its rows sent back as read pass too.
    expect((await put(id, { title: "Gateway 3", accounts: read.json().data.accounts })).statusCode).toBe(200);
  });

  it("refuses a save that clears the required password with null or an empty text, and keeps it", async () => {
    const created = await app.inject({
      method: "POST", url: "/api/v1/resource/RequiredVault", headers: authHeaders(),
      payload: { title: "Clear me", secret: "api-key-2", accounts: [] },
    });
    const id = created.json().data._id as string;
    const before = (await db.findOne("RequiredVault", id, "app")) as Record<string, unknown>;
    for (const secret of [null, ""]) {
      const res = await put(id, { secret });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.field).toBe("secret");
    }
    expect(((await db.findOne("RequiredVault", id, "app")) as Record<string, unknown>)["secret"]).toEqual(before["secret"]);
  });

  it("PLANTED INNOCENT: still refuses a save of a record whose required password was never stored", async () => {
    await db.insertOne(
      "RequiredVault",
      { _id: "RV-BARE", doctype: "RequiredVault", docstatus: 0, owner: "admin@digita.local", modified_by: "admin@digita.local", creation: new Date(), modified: new Date(), title: "Bare", accounts: [] },
      "app",
    );
    const res = await put("RV-BARE", { title: "Bare 2" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.field).toBe("secret");
  });
});
