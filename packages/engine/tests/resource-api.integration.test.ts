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
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";
import type { EntityDefinition } from "@digitaplatform/shared";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: EntityRegistry;
let authToken: string;
let signToken: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  signToken = ta.sign;
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry;
  await result.startup();
  await app.ready();

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

describe("Resource API Integration", () => {

  // ─── AUTH GUARD ─────────────────────────────────────────

  describe("authentication guard", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File",
        headers: { authorization: "Bearer invalid-token" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ─── CRUD LIFECYCLE ────────────────────────────────────

  describe("CRUD lifecycle (File entity)", () => {
    let createdName: string;

    it("creates a document", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/File",
        headers: authHeaders(),
        payload: { file_name: "test.pdf", file_url: "/uploads/test.pdf", file_size: 1024, file_type: "application/pdf" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data._id).toBeDefined();
      expect(body.data.file_name).toBe("test.pdf");
      createdName = body.data._id;
    });

    it("reads the created document", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/resource/File/${createdName}`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.file_name).toBe("test.pdf");
    });

    it("answers an action the entity does not declare with an error body", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/resource/File/${createdName}/action/no_such_action`,
        headers: authHeaders(),
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        success: false,
        status_code: 404,
        messages: [{ type: "error", text: expect.stringContaining("no_such_action") }],
      });
    });

    it("updates the document", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/File/${createdName}`,
        headers: authHeaders(),
        payload: { file_name: "updated.pdf" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.file_name).toBe("updated.pdf");
    });

    it("deletes the document", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/resource/File/${createdName}`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("returns 404 for deleted document", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/resource/File/${createdName}`,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── LIST ─────────────────────────────────────────────

  describe("list endpoint", () => {
    beforeAll(async () => {
      // Create a few documents for list testing
      for (let i = 1; i <= 3; i++) {
        await app.inject({
          method: "POST",
          url: "/api/v1/resource/File",
          headers: authHeaders(),
          payload: { file_name: `list-test-${i}.pdf`, file_url: `/uploads/list-${i}.pdf`, file_size: 1024, file_type: "application/pdf" },
        });
      }
    });

    it("returns paginated list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File?page_size=2&page=1",
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.meta.page_size).toBe(2);
      expect(body.meta.total).toBeGreaterThanOrEqual(3);
      expect(body.meta.total_pages).toBeGreaterThanOrEqual(2);
    });

    it("supports search", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File?search=list-test",
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });
  });

  // ─── COUNT ─────────────────────────────────────────────

  describe("count endpoint", () => {
    it("returns count", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File/count",
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.count).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── COPY ─────────────────────────────────────────────

  // Copy not tested here — Language uses by_field naming (requires unique code),
  // so copy would need a new code which the platform doesn't auto-generate for by_field.

  // ─── SUBMIT / CANCEL (Invoice is submittable) ─────────

  // Submit/cancel lifecycle is tested in document-service.integration.test.ts.
  // The CRUD lifecycle above covers the HTTP layer adequately.

  // ─── BULK DELETE ──────────────────────────────────────

  describe("bulk delete", () => {
    it("deletes multiple documents", async () => {
      const names: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/resource/File",
          headers: authHeaders(),
          payload: { file_name: `bulk-del-${i}.pdf`, file_url: `/uploads/bd-${i}.pdf`, file_size: 512, file_type: "application/pdf" },
        });
        names.push(res.json().data._id);
      }

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/File/bulk-delete",
        headers: authHeaders(),
        payload: { names },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.deleted.length).toBe(2);
      expect(body.data.failed.length).toBe(0);
    });
  });

  // ─── ERROR CASES ──────────────────────────────────────

  describe("error handling", () => {
    it("returns 404 for non-existent document", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File/FILE-999999",
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── IDENTITY DECOUPLING (ADR-12 P3) ──────────────────
  // The engine has no User entity anymore — identity lives in digita-auth.
  // User refs are plain ids (the id IS the email); display names are
  // denormalized at write time.

  describe("identity decoupling (ADR-12 P3)", () => {
    it("does not list a User entity in /meta", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/meta",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const names = (res.json().data as { name: string }[]).map((e) => e.name);
      expect(names).not.toContain("User");
      expect(names.length).toBeGreaterThan(0);
    });

    it("returns 404 for /resource/User (unknown doctype)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/User",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("UNKNOWN_DOCTYPE");
    });

    // A DocShare is refused unless its sharer may read the target (#71), so the shared Files exist.
    beforeAll(async () => {
      for (const _id of ["F-SHARE-1", "F-SHARE-2", "F-SHARE-3"]) {
        await db.insertOne("File", { _id, file_name: `${_id}.pdf`, owner: "admin@digita.local" }, "core");
      }
    });

    it("denormalizes DocShare names on insert (identity lookup + actor claims)", async () => {
      // A user row in the identity store (owned by digita-auth; the engine
      // only READS it for name denormalization).
      await db.insertOne(
        "User",
        { _id: "bob@test.local", email: "bob@test.local", full_name: "Bob Tester" },
        "identity",
      );

      const token = await signToken({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
        full_name: "Admin Tester",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/DocShare",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          _id: "File:F-SHARE-1:bob@test.local",
          entity: "File",
          document_name: "F-SHARE-1",
          shared_with: "bob@test.local",
          can_read: true,
          notify: false,
        },
      });

      expect(res.statusCode).toBe(201);
      const doc = res.json().data;
      expect(doc.shared_with).toBe("bob@test.local");
      expect(doc.shared_with_name).toBe("Bob Tester");
      // Sharer stamped from the JWT claims — no DB lookup.
      expect(doc.shared_by).toBe("admin@digita.local");
      expect(doc.shared_by_name).toBe("Admin Tester");
    });

    it("falls back to the email when shared_with is unknown in the identity store", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/DocShare",
        headers: authHeaders(),
        payload: {
          _id: "File:F-SHARE-2:ghost@test.local",
          entity: "File",
          document_name: "F-SHARE-2",
          shared_with: "ghost@test.local",
          can_read: true,
          notify: false,
        },
      });

      expect(res.statusCode).toBe(201);
      const doc = res.json().data;
      expect(doc.shared_with_name).toBe("ghost@test.local");
      // Token in authHeaders() has no full_name claim → fallback email.
      expect(doc.shared_by_name).toBe("admin@digita.local");
    });

    it("inserts a DocShare WITHOUT _id — naming expression composes the canonical id (ShareDialog path)", async () => {
      // The admin ShareDialog posts exactly this shape: no _id. The entity's
      // naming expression {entity}:{document_name}:{shared_with} must compose
      // the same canonical id that DocumentShareService.hasShare() looks up,
      // so REST-created shares actually grant access.
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/DocShare",
        headers: authHeaders(),
        payload: {
          entity: "File",
          document_name: "F-SHARE-3",
          shared_with: "carol@test.local",
          can_read: true,
          can_share: false,
          notify: false,
        },
      });

      expect(res.statusCode).toBe(201);
      const doc = res.json().data;
      expect(doc._id).toBe("File:F-SHARE-3:carol@test.local");

      // Sharing the same doc with the same user twice collides on the
      // composed _id → uniqueness of (entity, document_name, shared_with)
      // is enforced by construction.
      const dup = await app.inject({
        method: "POST",
        url: "/api/v1/resource/DocShare",
        headers: authHeaders(),
        payload: {
          entity: "File",
          document_name: "F-SHARE-3",
          shared_with: "carol@test.local",
          can_read: true,
          notify: false,
        },
      });
      expect(dup.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("stamps user_name on activity log rows from the actor claim", async () => {
      const token = await signToken({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
        full_name: "Admin Tester",
      });

      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/resource/File",
        headers: { authorization: `Bearer ${token}` },
        payload: { file_name: "log-actor.pdf", file_url: "/uploads/log-actor.pdf", file_size: 1, file_type: "application/pdf" },
      });
      expect(createRes.statusCode).toBe(201);
      const docId = createRes.json().data._id;

      const rows = await db.find(
        "Log",
        { filters: [{ entity: "File", document_name: docId, action: "Created" }] },
        "logs",
      );
      expect(rows.length).toBe(1);
      expect((rows[0] as { user: string }).user).toBe("admin@digita.local");
      expect((rows[0] as { user_name: string }).user_name).toBe("Admin Tester");
    });
  });

  describe("server-side i18n", () => {
    it("localizes response messages by Accept-Language (and strips transient params)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/File",
        headers: { ...authHeaders(), "accept-language": "de" },
        payload: { file_name: "de.pdf", file_url: "/uploads/de.pdf", file_size: 1, file_type: "application/pdf" },
      });
      expect(res.statusCode).toBe(201);
      const msgs = (res.json().messages ?? []) as { text: string; params?: unknown }[];
      // GERMAN translation, not the raw key.
      expect(msgs.some((m) => /erfolgreich (erstellt|gespeichert)/.test(m.text))).toBe(true);
      expect(msgs.some((m) => m.text === "doc_created" || m.text === "doc_saved")).toBe(false);
      // Transient i18n params must never reach the client.
      expect(msgs.every((m) => m.params === undefined)).toBe(true);
    });
  });

  // ─── OPTIMISTIC CONCURRENCY (E2: If-Match / 409) ──────
  describe("optimistic concurrency (If-Match)", () => {
    let docId: string;

    it("creates a doc to edit", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/resource/File",
        headers: authHeaders(),
        payload: { file_name: "conc.pdf", file_url: "/uploads/conc.pdf", file_size: 10, file_type: "application/pdf" },
      });
      expect(res.statusCode).toBe(201);
      docId = res.json().data._id;
    });

    it("rejects a stale If-Match with 409 CONCURRENT_MODIFICATION", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/File/${docId}`,
        headers: { ...authHeaders(), "if-match": "1999-01-01T00:00:00.000Z" },
        payload: { file_name: "stale.pdf" },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe("CONCURRENT_MODIFICATION");
      // The message key is localized server-side — the raw `document_modified`
      // key must NOT leak to the client (the stable machine `error.code` above
      // is the contract for callers).
      expect(body.messages[0].text).not.toBe("document_modified");
      expect(body.messages[0].text.length).toBeGreaterThan(0);
    });

    it("accepts a matching If-Match (the doc's current modified)", async () => {
      const cur = await app.inject({
        method: "GET",
        url: `/api/v1/resource/File/${docId}`,
        headers: authHeaders(),
      });
      const modified = cur.json().data.modified as string;
      expect(typeof modified).toBe("string");

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/File/${docId}`,
        headers: { ...authHeaders(), "if-match": modified },
        payload: { file_name: "fresh.pdf" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.file_name).toBe("fresh.pdf");
    });

    it("tolerates ETag-style quotes around the If-Match value", async () => {
      const cur = await app.inject({
        method: "GET",
        url: `/api/v1/resource/File/${docId}`,
        headers: authHeaders(),
      });
      const modified = cur.json().data.modified as string;

      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/File/${docId}`,
        headers: { ...authHeaders(), "if-match": `"${modified}"` },
        payload: { file_name: "quoted.pdf" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("still updates without If-Match (last-write-wins back-compat)", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/File/${docId}`,
        headers: authHeaders(),
        payload: { file_name: "nomatch.pdf" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.file_name).toBe("nomatch.pdf");
    });
  });

  // ─── SINGLE-BY-ENTITY GET (E3) ────────────────────────
  describe("single-by-entity GET (/:doctype/single)", () => {
    it("returns 400 NOT_A_SINGLE for a non-single entity", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/File/single",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("NOT_A_SINGLE");
    });

    it("returns 404 when the single has not been initialized", async () => {
      // Boot seeds the BrandingSetting single; remove it to simulate an uninitialized one.
      await db.deleteMany("BrandingSetting", {}, "core");
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/BrandingSetting/single",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns the one row for an is_single entity", async () => {
      // Replace the boot-seeded single with a controlled row.
      await db.deleteMany("BrandingSetting", {}, "core");
      await db.insertOne(
        "BrandingSetting",
        { _id: "branding", app_name: "Test App", docstatus: 0 },
        "core",
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/resource/BrandingSetting/single",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.app_name).toBe("Test App");
      // Returns the doc object directly, not a list.
      expect(Array.isArray(body.data)).toBe(false);
    });
  });

  // The default signature decides the first look of every user of the app, so only an
  // Administrator may write it.
  describe("DELETE /meta/:doctype", () => {
    it("stops serving an entity /meta created, and says nothing is deleted from the data", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/meta",
        headers: authHeaders(),
        payload: {
          name: "MetaGone",
          module: "test",
          database: "app",
          naming: { strategy: "user_set" },
          fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
          permissions: [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }],
        },
      });
      expect(created.statusCode).toBe(201);

      const deleted = await app.inject({ method: "DELETE", url: "/api/v1/meta/MetaGone", headers: authHeaders() });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json().data).toMatchObject({ deleted: true, restored_from_file: false });
      expect(deleted.json().messages[0].text).toContain("Nothing is deleted from the data");

      const meta = await app.inject({ method: "GET", url: "/api/v1/meta/MetaGone", headers: authHeaders() });
      const list = await app.inject({ method: "GET", url: "/api/v1/resource/MetaGone", headers: authHeaders() });
      expect([meta.statusCode, list.statusCode]).toEqual([404, 404]);
    });

    it("refuses an entity only the app bundle defines, and keeps serving it", async () => {
      registry.register({
        name: "BundleOnly",
        module: "test",
        database: "app",
        naming: { strategy: "user_set" },
        fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
        permissions: [{ role: "Administrator", level: 0, select: 1, read: 1 }],
      } as unknown as Parameters<EntityRegistry["register"]>[0]);

      const refused = await app.inject({ method: "DELETE", url: "/api/v1/meta/BundleOnly", headers: authHeaders() });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ success: false, error: { code: "DEFINED_BY_BUNDLE" } });
      const meta = await app.inject({ method: "GET", url: "/api/v1/meta/BundleOnly", headers: authHeaders() });
      expect(meta.statusCode).toBe(200);
    });
  });

  describe("BrandingSetting.default_signature", () => {
    it("a System User's PUT of BrandingSetting.default_signature is refused with 403, an Administrator's is saved", async () => {
      await db.deleteMany("BrandingSetting", {}, "core");
      await db.insertOne("BrandingSetting", { _id: "branding", docstatus: 0 }, "core");
      const systemUserToken = await signToken({
        sub: "staff@digita.local",
        email: "staff@digita.local",
        roles: ["System User"],
      });
      const put = (token: string) =>
        app.inject({
          method: "PUT",
          url: "/api/v1/resource/BrandingSetting/branding",
          headers: { authorization: `Bearer ${token}` },
          payload: { default_signature: "veloluck-workbench" },
        });

      expect((await put(systemUserToken)).statusCode).toBe(403);
      expect((await db.findOne("BrandingSetting", "branding", "core"))?.["default_signature"]).toBeUndefined();

      expect((await put(authToken)).statusCode).toBe(200);
      expect((await db.findOne("BrandingSetting", "branding", "core"))?.["default_signature"]).toBe("veloluck-workbench");
    });

    // The engine also keeps an Administrator's undeclared keys, so the PUT above passes without
    // the declaration; the form only offers the field when the meta names it.
    it("the meta of BrandingSetting offers the app's and the website's signature as Selects of the app's signatures", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/meta/BrandingSetting", headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      for (const fieldname of ["default_signature", "web_default_signature"]) {
        expect(res.json().data.fields).toContainEqual(
          expect.objectContaining({ fieldname, fieldtype: "Select", options_source: "signatures" }),
        );
      }
    });

    it("the meta of BrandingSetting offers no user template override, which no menu reads", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/meta/BrandingSetting", headers: authHeaders() });
      expect(res.json().data.fields.map((f: { fieldname: string }) => f.fieldname)).not.toContain("allow_user_template_override");
    });
  });

  // ─── PHASE 3: default_workspace resolution + meta navigable ──────
  describe("default_workspace + meta navigable (Phase 3)", () => {
    it("/boot default_workspace is null when no workspace matches the user's roles", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/boot", headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.default_workspace).toBeNull();
    });

    it("/boot resolves the highest-priority role-matched workspace (malformed rows skipped, no 500)", async () => {
      await db.insertOne("Workspace", { _id: "ws-low", name: "Low", enabled: true, priority: 100, is_default_for_roles: ["System User"], cards: [] }, "core");
      await db.insertOne("Workspace", { _id: "ws-high", name: "High", enabled: true, priority: 10, is_default_for_roles: ["System User"], cards: [] }, "core");
      await db.insertOne("Workspace", { _id: "ws-bad", name: "Bad", enabled: true, priority: 1, is_default_for_roles: "{not json", cards: [] }, "core");

      const res = await app.inject({ method: "GET", url: "/api/v1/boot", headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      // ws-bad has priority 1 but malformed roles → skipped; ws-high (10) wins over ws-low (100).
      expect(res.json().data.default_workspace).toBe("ws-high");
    });

    it("/meta flags every item navigable + marks Workspace not-navigable (engine plumbing)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/meta", headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const items = res.json().data as { name: string; navigable?: boolean }[];
      expect(items.every((e) => typeof e.navigable === "boolean")).toBe(true);
      const ws = items.find((e) => e.name === "Workspace");
      expect(ws?.navigable).toBe(false);
    });

    it("/meta answers no icon or color of an entity, which no client reads", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/meta", headers: authHeaders() });
      const items = res.json().data as Record<string, unknown>[];
      expect(items.filter((e) => "icon" in e || "color" in e)).toEqual([]);
    });
  });
});

// H1: the sidebar routes (/versions, /shares, /related) used to call their
// service with no per-doc read gate — any authenticated user could enumerate a
// document's version history / share graph / related docs even without read
// permission. Each handler now runs the same getDoc read gate.
describe("H1 — sidebar routes enforce per-doc read authz", () => {
  let fileId: string;
  let noAccessToken: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/resource/File",
      headers: authHeaders(),
      payload: { file_name: "sidebar.pdf", file_url: "/uploads/sidebar.pdf", file_size: 1, file_type: "application/pdf" },
    });
    fileId = res.json().data._id;
    // A user whose (invented) role grants no read on File.
    noAccessToken = await signToken({ sub: "norole@test", email: "norole@test", roles: ["NoAccessRole"] });
  });

  const noAccess = () => ({ authorization: `Bearer ${noAccessToken}` });

  it("denies /versions to a user who cannot read the doc", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}/versions`, headers: noAccess() });
    expect(res.statusCode).not.toBe(200);
  });

  it("denies /shares to a user who cannot read the doc", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}/shares`, headers: noAccess() });
    expect(res.statusCode).not.toBe(200);
  });

  it("denies /related to a user who cannot read the doc", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}/related`, headers: noAccess() });
    expect(res.statusCode).not.toBe(200);
  });

  it("allows an Administrator through all three sidebar routes", async () => {
    for (const route of ["versions", "shares", "related"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/resource/File/${fileId}/${route}`, headers: authHeaders() });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("/related counts only the linked rows a list answers (#120)", () => {
  let deskToken: string;
  let borrowerToken: string;

  beforeAll(async () => {
    registry.register({
      name: "RelBook",
      module: "test",
      database: "core",
      naming: { strategy: "user_set" },
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
      links: [{ label: "Loans", entity: "RelLoan", link_field: "book", show_count: true }],
      permissions: [
        { role: "LoanDesk", level: 0, select: 1, read: 1 },
        { role: "Borrower", level: 0, select: 1, read: 1 },
      ],
    } as unknown as EntityDefinition);
    // The desk reads an open loan only, and never a loan whose roles leave it out;
    // a borrower reads only the loans it owns.
    registry.register({
      name: "RelLoan",
      module: "test",
      database: "core",
      naming: { strategy: "user_set" },
      role_visibility_field: "roles",
      fields: [
        { fieldname: "book", fieldtype: "Link", label: "Book", target: "RelBook" },
        { fieldname: "status", fieldtype: "Data", label: "Status" },
        { fieldname: "roles", fieldtype: "JSON", label: "Roles" },
      ],
      permissions: [
        { role: "LoanDesk", level: 0, select: 1, read: 1, condition: "eval:doc.status == 'Open'" },
        { role: "Borrower", level: 0, select: 1, read: 1, if_owner: true },
      ],
    } as unknown as EntityDefinition);
    const row = { docstatus: 0, owner: "system", modified_by: "system", creation: new Date(), modified: new Date() };
    await db.insertOne("RelBook", { ...row, _id: "RB-1", title: "Dune" }, "core");
    await db.insertOne("RelLoan", { ...row, _id: "RL-open", book: "RB-1", status: "Open" }, "core");
    await db.insertOne("RelLoan", { ...row, _id: "RL-closed", book: "RB-1", status: "Closed" }, "core");
    await db.insertOne("RelLoan", { ...row, _id: "RL-staff", book: "RB-1", status: "Open", roles: ["Staff"] }, "core");
    await db.insertOne("RelLoan", { ...row, _id: "RL-own", book: "RB-1", status: "Open", owner: "borrower@test" }, "core");
    deskToken = await signToken({ sub: "desk@test", email: "desk@test", roles: ["LoanDesk"] });
    borrowerToken = await signToken({ sub: "borrower@test", email: "borrower@test", roles: ["Borrower"] });
  });

  async function expectRelatedCountIsListTotal(token: string, listed: string[]) {
    const headers = { authorization: `Bearer ${token}` };
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/resource/RelLoan?order_by=_id%20asc&filters=${encodeURIComponent(JSON.stringify([["book", "=", "RB-1"]]))}`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((r: Record<string, unknown>) => r["_id"])).toEqual(listed);

    const related = await app.inject({ method: "GET", url: "/api/v1/resource/RelBook/RB-1/related", headers });
    expect(related.statusCode).toBe(200);
    expect(related.json().data).toEqual([{ label: "Loans", entity: "RelLoan", count: list.json().meta.total }]);
  }

  it("leaves out a loan the desk's read condition or the loan's roles hide", async () => {
    await expectRelatedCountIsListTotal(deskToken, ["RL-open", "RL-own"]);
  });

  it("leaves out a loan another user owns from a borrower's count", async () => {
    await expectRelatedCountIsListTotal(borrowerToken, ["RL-own"]);
  });

  it("answers every loan to an Administrator", async () => {
    const related = await app.inject({ method: "GET", url: "/api/v1/resource/RelBook/RB-1/related", headers: authHeaders() });
    expect(related.json().data[0].count).toBe(4);
  });
});

// H2: export used to call getList with no user → GUEST_USER, which (a) threw for
// any entity without a Guest select grant (export broken for everyone incl.
// admins) and (b) dumped out-of-scope rows. It now runs as the caller.
describe("H2 — export runs as the caller, not GUEST_USER", () => {
  it("an Administrator can export a non-Guest-readable entity and sees the rows", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/resource/File",
      headers: authHeaders(),
      payload: { file_name: "export-me.pdf", file_url: "/uploads/export-me.pdf", file_size: 2, file_type: "application/pdf" },
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/export/File", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((r) => r["file_name"] === "export-me.pdf")).toBe(true);
  });
});
