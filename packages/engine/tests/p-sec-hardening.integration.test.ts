import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Engine-only env (no APP_DIRS): the test registers its own entities.
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
    LOG_SEQ_ENABLED: false, LOG_SEQ_URL: "", LOG_SEQ_API_KEY: "",
    BOOTSTRAP_LOCALE: "en", TRANSLATION_SOURCE: "file", TRANSLATION_CACHE: "none",
    TRANSLATION_CACHE_TTL_SEC: 0, TRANSLATION_SEED_ON_BOOT: false, TRANSLATION_FALLBACK_LOCALE: "en",
    API_RATE_LIMIT_MAX: 1000, API_RATE_LIMIT_WINDOW: "1m", API_MAX_BODY_SIZE: "10mb", API_TIMEOUT_MS: 60000,
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    UPLOAD_MAX_SIZE: "25mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: "./uploads",
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", LOCALES_DIR: "./src/locales",
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
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: { register: (e: EntityDefinition) => void };
let sign: (c: { sub: string; email: string; roles: string[]; tiers?: string[] }) => Promise<string>;

let adminTok: string; // Administrator, internal
let internalTok: string; // PortalUser, tiers:['internal']
let externalTok: string; // PortalUser, tiers:['external']
let noTiersTok: string; // System User with an EMPTY tier-set (no assigned tier → not internal)
let secId: string;

/** A PortalUser-readable entity with a perm_level-1 field the portal role can't read. */
const SEC: EntityDefinition = {
  name: "SecDoc",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "SEC-", pad_length: 4 },
  is_submittable: false,
  is_log: false,
  track_changes: false,
  track_views: false,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "secret_note", fieldtype: "Data", label: "Internal note", perm_level: 1 },
  ],
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    { role: "PortalUser", level: 0, select: 1, read: 1, write: 1 },
  ],
} as unknown as EntityDefinition;

/** An entity PortalUser cannot select at all (admin-only) — for the 404 probe. */
const HIDDEN: EntityDefinition = {
  ...SEC,
  name: "HiddenDoc",
  naming: { strategy: "auto_increment", prefix: "HID-", pad_length: 4 },
  permissions: [
    { role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
  ],
} as unknown as EntityDefinition;

const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  sign = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry as unknown as { register: (e: EntityDefinition) => void };
  await result.startup();
  await app.ready();

  registry.register(SEC);
  registry.register(HIDDEN);

  adminTok = await sign({ sub: "admin@d", email: "admin@d", roles: ["Administrator", "System User"], tiers: ["internal"] });
  internalTok = await sign({ sub: "op@d", email: "op@d", roles: ["PortalUser"], tiers: ["internal"] });
  externalTok = await sign({ sub: "ext@d", email: "ext@d", roles: ["PortalUser"], tiers: ["external"] });
  noTiersTok = await sign({ sub: "legacy@d", email: "legacy@d", roles: ["System User"], tiers: [] });

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/resource/SecDoc",
    headers: bearer(adminTok),
    payload: { title: "Public Title", secret_note: "classified" },
  });
  expect(created.statusCode).toBe(201);
  secId = created.json().data._id as string;
}, 90000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("P-SEC/R4 — meta + translation mutations are Administrator-gated", () => {
  for (const [label, tok] of [["external PortalUser", () => externalTok], ["internal PortalUser", () => internalTok]] as const) {
    it(`403s a non-admin (${label}) POST /meta`, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/meta",
        headers: bearer(tok()),
        payload: { name: "Evil", module: "x", database: "app", fields: [] },
      });
      expect(res.statusCode).toBe(403);
    });

    it(`403s a non-admin (${label}) PUT /meta/:doctype (permission-rewrite path)`, async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/meta/SecDoc",
        headers: bearer(tok()),
        payload: { permissions: [{ role: "PortalUser", level: 0, read: 1, write: 1, delete: 1 }] },
      });
      expect(res.statusCode).toBe(403);
    });

    it(`403s a non-admin (${label}) DELETE /meta/:doctype`, async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/meta/SecDoc", headers: bearer(tok()) });
      expect(res.statusCode).toBe(403);
    });

    it(`403s a non-admin (${label}) translation write`, async () => {
      const res = await app.inject({ method: "PUT", url: "/api/v1/translations/en/some.key", headers: bearer(tok()), payload: { value: "pwned" } });
      expect(res.statusCode).toBe(403);
    });
  }

  it("admin PUT /meta/:doctype succeeds (gate passes for Administrator)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/meta/SecDoc",
      headers: bearer(adminTok),
      payload: { label: "Sec Doc" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("admin translation write succeeds", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/translations/en/p_sec.key", headers: bearer(adminTok), payload: { value: "ok" } });
    expect(res.statusCode).toBe(200);
  });

  it("translation GET readers stay open to a non-admin", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/translations/en", headers: bearer(externalTok) });
    expect(res.statusCode).toBe(200);
  });
});

describe("P-SEC/R3 — GET /meta/:doctype is AUDIENCE-projected (internal unchanged)", () => {
  it("an admin (internal) sees the full definition incl. permissions[] and the perm_level field", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/SecDoc", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(Array.isArray(d.permissions)).toBe(true);
    expect(d.permissions.length).toBeGreaterThan(0);
    expect(d.fields.map((f: { fieldname: string }) => f.fieldname)).toContain("secret_note");
  });

  it("an INTERNAL non-admin (System-User-like) still gets the full definition — no operator-UI regression", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/SecDoc", headers: bearer(internalTok) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // The operator UI reads entity.permissions + perm_level client-side, so an
    // internal operator must keep them even without the Administrator role.
    expect(d.permissions.length).toBeGreaterThan(0);
    expect(d.fields.map((f: { fieldname: string }) => f.fieldname)).toContain("secret_note");
  });

  it("an EXTERNAL caller gets no permissions[] and no perm_level-gated field", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/SecDoc", headers: bearer(externalTok) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.permissions).toEqual([]);
    const fieldNames = d.fields.map((f: { fieldname: string }) => f.fieldname);
    expect(fieldNames).toContain("title");
    expect(fieldNames).not.toContain("secret_note");
  });

  it("404s an EXTERNAL caller on a doctype it cannot select (existence not revealed)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/HiddenDoc", headers: bearer(externalTok) });
    expect(res.statusCode).toBe(404);
  });

  it("an INTERNAL non-admin is NOT 404'd on an unselectable doctype (unchanged behaviour)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/HiddenDoc", headers: bearer(internalTok) });
    expect(res.statusCode).toBe(200);
  });

  it("admin can read the hidden doctype's meta", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta/HiddenDoc", headers: bearer(adminTok) });
    expect(res.statusCode).toBe(200);
  });
});

describe("P-SEC/R3c — /openapi.json is gated to the internal audience", () => {
  it("403s an external (non-internal) token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: bearer(externalTok) });
    expect(res.statusCode).toBe(403);
  });
  it("allows an internal token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: bearer(internalTok) });
    expect(res.statusCode).toBe(200);
  });
  it("denies a token with no assigned tier (fail-closed: no valid tiers ⇒ not internal)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: bearer(noTiersTok) });
    expect(res.statusCode).toBe(403);
  });
});

describe("P-SEC/R5 — operator identity stripped from reads for non-internal audiences", () => {
  it("an external reader gets title but NO owner/modified_by (and no perm_level field)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/SecDoc/${secId}`, headers: bearer(externalTok) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.title).toBe("Public Title");
    expect(d.owner).toBeUndefined();
    expect(d.modified_by).toBeUndefined();
    expect(d.secret_note).toBeUndefined();
  });

  it("an internal reader keeps owner/modified_by", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/SecDoc/${secId}`, headers: bearer(internalTok) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.owner).toBeDefined();
    expect(d.modified_by).toBeDefined();
  });
});

describe("P-SEC/R7 — filter field allow-list blocks NoSQL operator injection", () => {
  it("400s a $where injection on the resource list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc?filters=${encodeURIComponent('[["$where","=","sleep(1)"]]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("FILTER_FIELD_NOT_ALLOWED");
  });

  it("400s a filter on an undeclared field", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc?filters=${encodeURIComponent('[["password","=","x"]]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows a filter on a declared field", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc?filters=${encodeURIComponent('[["title","=","Public Title"]]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("P-SEC/R7 — the COUNT endpoint enforces the same allow-list + RBAC (review fix)", () => {
  it("400s a top-level $-operator key injection ($where)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc/count?filters=${encodeURIComponent('[{"$where":"sleep(1)"}]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("FILTER_FIELD_NOT_ALLOWED");
  });

  it("400s an undeclared-field oracle ($regex on a non-declared key)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc/count?filters=${encodeURIComponent('[{"password":{"$regex":"^A"}}]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows a declared-field count filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/resource/SecDoc/count?filters=${encodeURIComponent('[{"title":"Public Title"}]')}`,
      headers: bearer(adminTok),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBeGreaterThanOrEqual(1);
  });

  it("403s a caller with no select grant on the entity (count was previously ungated)", async () => {
    // noTiersTok is a System User with no permission on SecDoc.
    const res = await app.inject({ method: "GET", url: "/api/v1/resource/SecDoc/count", headers: bearer(noTiersTok) });
    expect(res.statusCode).toBe(403);
  });
});

describe("P-SEC/R5 — write echoes also strip operator identity for non-internal audiences (review fix)", () => {
  it("an external write echo (update) omits owner/modified_by", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/SecDoc/${secId}`,
      headers: bearer(externalTok),
      payload: { title: "Edited by external" },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.owner).toBeUndefined();
    expect(d.modified_by).toBeUndefined();
  });

  it("an internal write echo (update) keeps owner/modified_by", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/resource/SecDoc/${secId}`,
      headers: bearer(internalTok),
      payload: { title: "Edited by internal" },
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.owner).toBeDefined();
    expect(d.modified_by).toBeDefined();
  });
});
