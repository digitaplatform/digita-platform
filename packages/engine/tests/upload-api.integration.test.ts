import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", async () => {
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const uploadDir = join(
    tmpdir(),
    `digita-upload-it-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
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
    // Small fileSize limit so the truncation guard is testable without MB payloads.
    UPLOAD_MAX_SIZE: "64kb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: uploadDir,
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.*"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", LOCALES_DIR: "./src/locales",
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
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
import Jimp from "jimp";
import { access, readdir, readFile, rm, mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let registry: EntityRegistry;
let ta: Awaited<ReturnType<typeof buildTestAuth>>;
let authToken: string;
/** Non-admin System User — owns nothing uploaded by admin. */
let salesToken: string;
/** Non-admin System User used as file OWNER in the RBAC tests. */
let ownerToken: string;

const uploadDir = env.UPLOAD_LOCAL_PATH;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry;
  await result.startup();
  await app.ready();

  // Fixture entities for the entity-scoped upload scheme. Registered after
  // startup (boot lint already passed for the real tree); the upload-router
  // resolves the registry at request time.
  registry.register({
    name: "TestCustomer",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    storage_path: "customers",
    fields: [
      { fieldname: "company_name", fieldtype: "Data", label: "Company name" },
      { fieldname: "profile_image", fieldtype: "AttachImage", label: "Profile image" },
      // Public opt-in field — attachments here are anonymously readable.
      { fieldname: "public_banner", fieldtype: "AttachImage", label: "Public banner", public: true },
    ],
    permissions: [],
  } as unknown as EntityDefinition);
  registry.register({
    name: "TestNoPath",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    // No storage_path on purpose — uploads against it must be rejected.
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    permissions: [],
  } as unknown as EntityDefinition);
  // A parent entity a plain System User CAN read (role-level, no if_owner) — a
  // private attachment on its doc must be downloadable by such a reader.
  registry.register({
    name: "TestShared",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    storage_path: "shared",
    fields: [{ fieldname: "profile_image", fieldtype: "AttachImage", label: "Profile image" }],
    permissions: [{ role: "System User", level: 0, read: 1 }],
  } as unknown as EntityDefinition);
  // A two-segment storage_path — a raster upload here used to 500 because the
  // thumbnail key exceeded the local backend's 3-segment cap.
  registry.register({
    name: "TestNested",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    storage_path: "web/branding",
    fields: [{ fieldname: "logo", fieldtype: "AttachImage", label: "Logo" }],
    permissions: [],
  } as unknown as EntityDefinition);

  authToken = await ta.sign({
    sub: "admin@digita.local",
    email: "admin@digita.local",
    roles: ["Administrator", "System User"],
  });
  salesToken = await ta.sign({
    sub: "sales@digita.local",
    email: "sales@digita.local",
    roles: ["System User"],
  });
  ownerToken = await ta.sign({
    sub: "owner@digita.local",
    email: "owner@digita.local",
    roles: ["System User"],
  });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
  await rm(uploadDir, { recursive: true, force: true });
}, 30000);

function authHeaders(token = authToken) {
  return { authorization: `Bearer ${token}` };
}

/**
 * Build a single-file multipart/form-data payload for app.inject. Extra text
 * fields (the attachment context) are emitted BEFORE the file part — the
 * backend reads the stream sequentially and resolves the context when it
 * reaches the file.
 */
function multipartPayload(
  filename: string,
  contentType: string,
  content: Buffer,
  fields: Record<string, string> = {},
) {
  const boundary = "----digitaUploadTestBoundary";
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `content-disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `content-disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `content-type: ${contentType}\r\n\r\n`,
    ),
  );
  parts.push(content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Default attachment context used by the happy-path tests. */
const CTX = {
  attached_to_entity: "TestCustomer",
  attached_to_name: "CUST-000001",
  attached_to_field: "profile_image",
};

describe("Upload API Integration", () => {
  const pdfContent = Buffer.from("%PDF-1.4 fake test pdf content for round-trip check");

  describe("authentication guard", () => {
    it("returns 401 on upload without auth header", async () => {
      const { payload, contentType } = multipartPayload("a.pdf", "application/pdf", pdfContent, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 on download without auth header", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/file/FILE-000001/download",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("attachment context enforcement (no-fallback rule)", () => {
    it("returns 400 when no attachment context is sent", async () => {
      const { payload, contentType } = multipartPayload("a.pdf", "application/pdf", pdfContent);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("ATTACHMENT_CONTEXT_REQUIRED");
      expect(body.error.detail).toContain("attached_to_entity");
    });

    it("returns 400 for an unknown entity", async () => {
      const { payload, contentType } = multipartPayload("a.pdf", "application/pdf", pdfContent, {
        attached_to_entity: "DoesNotExist",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("UNKNOWN_ENTITY");
      expect(body.error.detail).toContain("DoesNotExist");
    });

    it("returns 400 for an entity that declares no storage_path", async () => {
      const { payload, contentType } = multipartPayload("a.pdf", "application/pdf", pdfContent, {
        attached_to_entity: "TestNoPath",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("ENTITY_WITHOUT_STORAGE_PATH");
      expect(body.error.detail).toContain("TestNoPath");
      expect(body.error.detail).toContain("storage_path");
    });

    it("accepts the context via query parameters as an alternative transport", async () => {
      const { payload, contentType } = multipartPayload("q.pdf", "application/pdf", pdfContent);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload?attached_to_entity=TestCustomer&attached_to_field=profile_image",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.storage_key).toMatch(/^customers\//);
      expect(body.data.attached_to_entity).toBe("TestCustomer");
      // cleanup
      await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${body.data._id}`,
        headers: authHeaders(),
      });
    });
  });

  describe("upload → download → delete lifecycle", () => {
    let fileId: string;
    let fileUrl: string;
    let storageKey: string;

    it("uploads a file (201) with the download-route file_url + storage + attachment fields", async () => {
      const { payload, contentType } = multipartPayload(
        "report.pdf",
        "application/pdf",
        pdfContent,
        CTX,
      );
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data._id).toMatch(/^FILE-\d{6}$/);
      expect(body.data.file_name).toBe("report.pdf");
      expect(body.data.file_type).toBe("application/pdf");
      expect(body.data.file_size).toBe(pdfContent.length);
      expect(body.data.file_url).toBe(`/api/v1/file/${body.data._id}/download`);
      expect(body.data.storage_backend).toBe("local");
      // Key scheme: <storage_path>/<sha256><ext> (content-addressed for dedup)
      expect(body.data.storage_key).toMatch(/^customers\/[0-9a-f]{64}\.pdf$/);
      expect(body.data.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(body.data.attached_to_entity).toBe("TestCustomer");
      expect(body.data.attached_to_name).toBe("CUST-000001");
      expect(body.data.attached_to_field).toBe("profile_image");

      fileId = body.data._id;
      fileUrl = body.data.file_url;
      storageKey = body.data.storage_key;
    });

    it("stored the bytes on disk under UPLOAD_LOCAL_PATH/<storage_path>/", async () => {
      const onDisk = await readFile(join(uploadDir, ...storageKey.split("/")));
      expect(onDisk.equals(pdfContent)).toBe(true);
    });

    it("downloads the exact bytes back with content headers", async () => {
      const res = await app.inject({
        method: "GET",
        url: fileUrl,
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).equals(pdfContent)).toBe(true);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(Number(res.headers["content-length"])).toBe(pdfContent.length);
      expect(res.headers["content-disposition"]).toContain('inline; filename="report.pdf"');
    });

    it("deletes the doc AND the stored file", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${fileId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Blob gone from the backend
      await expect(access(join(uploadDir, ...storageKey.split("/")))).rejects.toThrow();
      // Doc gone from the collection
      const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE);
      expect(doc).toBeNull();
    });

    it("returns 404 on download after delete", async () => {
      const res = await app.inject({
        method: "GET",
        url: fileUrl,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FILE_NOT_FOUND");
    });

    it("returns 404 when deleting a missing file doc", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${fileId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /file/:id — replace content", () => {
    const v1Content = Buffer.from("%PDF-1.4 original version one content");
    const v2Content = Buffer.from("fake-png-bytes-version-two-replacement-content");
    let fileId: string;
    let fileUrl: string;
    let oldKey: string;

    it("uploads the original version", async () => {
      const { payload, contentType } = multipartPayload("v1.pdf", "application/pdf", v1Content, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      fileId = res.json().data._id;
      fileUrl = res.json().data.file_url;
      oldKey = res.json().data.storage_key;
    });

    it("rejects a replacement with a disallowed mimetype (original stays intact)", async () => {
      const { payload, contentType } = multipartPayload(
        "evil.zip",
        "application/zip",
        Buffer.from("PK"),
      );
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${fileId}`,
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("FILE_TYPE_NOT_ALLOWED");
      // Original blob untouched
      await expect(readFile(join(uploadDir, ...oldKey.split("/")))).resolves.toEqual(v1Content);
    });

    it("replaces the content: new key in same storage_path, doc updated, old object gone", async () => {
      const { payload, contentType } = multipartPayload("v2.png", "image/png", v2Content);
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${fileId}`,
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.file_name).toBe("v2.png");
      expect(body.data.file_type).toBe("image/png");
      expect(body.data.file_size).toBe(v2Content.length);
      expect(body.data.storage_key).toMatch(/^customers\/[0-9a-f]{64}\.png$/);
      expect(body.data.storage_key).not.toBe(oldKey);

      // Old object deleted, new object holds the new bytes.
      await expect(access(join(uploadDir, ...oldKey.split("/")))).rejects.toThrow();
      const onDisk = await readFile(join(uploadDir, ...body.data.storage_key.split("/")));
      expect(onDisk.equals(v2Content)).toBe(true);

      // Doc in the collection points at the new key.
      const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, DIGITA.DATABASES.CORE);
      expect(doc?.["storage_key"]).toBe(body.data.storage_key);
      expect(doc?.["file_name"]).toBe("v2.png");
      expect(doc?.["file_size"]).toBe(v2Content.length);
      // Attachment context survives the replace.
      expect(doc?.["attached_to_entity"]).toBe("TestCustomer");
    });

    it("serves the NEW bytes from the unchanged file_url", async () => {
      const res = await app.inject({
        method: "GET",
        url: fileUrl,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).equals(v2Content)).toBe(true);
      expect(res.headers["content-type"]).toContain("image/png");
    });

    it("returns 404 when replacing a missing file", async () => {
      const { payload, contentType } = multipartPayload("x.png", "image/png", Buffer.from("x"));
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/file/FILE-999999",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when replacing a legacy file without attachment context", async () => {
      await db.insertOne(
        DIGITA.COLLECTIONS.FILE,
        {
          _id: "FILE-900002",
          doctype: "file",
          docstatus: 0,
          file_name: "legacy-no-context.txt",
          file_url: "/uploads/legacy-no-context.txt",
          file_size: 5,
          file_type: "text/plain",
          is_private: true,
          owner: "admin@digita.local",
          modified_by: "admin@digita.local",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
      const { payload, contentType } = multipartPayload("x.png", "image/png", Buffer.from("x"));
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/file/FILE-900002",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("ATTACHMENT_CONTEXT_REQUIRED");
    });

    it("does an UNCONDITIONAL put on replace (repairs a stale/corrupt content-address blob)", async () => {
      const v3 = Buffer.from("version-three-unconditional-put-bytes");
      const hash = createHash("sha256").update(v3).digest("hex");
      const newKey = `customers/${hash}.png`;
      // Simulate a stale/racy object already sitting at the content-address (the
      // exact condition the old skip-put-if-exists mishandled).
      await mkdir(join(uploadDir, "customers"), { recursive: true });
      await writeFile(join(uploadDir, ...newKey.split("/")), Buffer.from("CORRUPT-STALE"));

      const { payload, contentType } = multipartPayload("v3.png", "image/png", v3);
      const put = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${fileId}`,
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.storage_key).toBe(newKey);

      // The unconditional put overwrote the corrupt pre-existing blob, so the
      // download serves the real new bytes — not the stale content.
      const get = await app.inject({ method: "GET", url: fileUrl, headers: authHeaders() });
      expect(get.statusCode).toBe(200);
      expect(Buffer.from(get.rawPayload).equals(v3)).toBe(true);
    });

    it("cleanup: delete the replaced file", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${fileId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("mimetype allow-list", () => {
    it("rejects a disallowed mimetype with 400 and a clear message", async () => {
      const { payload, contentType } = multipartPayload(
        "archive.zip",
        "application/zip",
        Buffer.from("PK fake zip"),
        CTX,
      );
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
      expect(body.error.detail).toContain("application/zip");
      expect(body.error.detail).toContain("not allowed");
    });

    it("accepts a wildcard match (image/*) and prefixes the key", async () => {
      const png = Buffer.from("89504e47-fake-png", "utf8");
      const { payload, contentType } = multipartPayload("pic.png", "image/png", png, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.storage_key).toMatch(/^customers\/[0-9a-f]{64}\.png$/);
    });
  });

  describe("content-addressed dedup + reference-counted delete (#1/#2)", () => {
    const dupContent = Buffer.from("dedup-identical-content-bytes-for-the-same-picture");
    let idA: string;
    let idB: string;
    let sharedKey: string;

    it("a second upload of identical content reuses the SAME storage object", async () => {
      const a = multipartPayload("logo.png", "image/png", dupContent, CTX);
      const resA = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": a.contentType },
        payload: a.payload,
      });
      expect(resA.statusCode).toBe(201);
      idA = resA.json().data._id;
      sharedKey = resA.json().data.storage_key;
      expect(resA.json().data.content_hash).toMatch(/^[0-9a-f]{64}$/);

      const b = multipartPayload("logo-copy.png", "image/png", dupContent, CTX);
      const resB = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": b.contentType },
        payload: b.payload,
      });
      expect(resB.statusCode).toBe(201);
      idB = resB.json().data._id;

      // Distinct File docs, but the SAME content-addressed key → one stored object.
      expect(idB).not.toBe(idA);
      expect(resB.json().data.storage_key).toBe(sharedKey);
      expect(resB.json().data.content_hash).toBe(resA.json().data.content_hash);

      const onDisk = await readFile(join(uploadDir, ...sharedKey.split("/")));
      expect(onDisk.equals(dupContent)).toBe(true);
    });

    it("deleting ONE reference keeps the shared blob (still referenced)", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${idA}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(await db.findOne(DIGITA.COLLECTIONS.FILE, idA, DIGITA.DATABASES.CORE)).toBeNull();
      // Blob still present; B still downloads.
      await expect(access(join(uploadDir, ...sharedKey.split("/")))).resolves.toBeUndefined();
      const dl = await app.inject({
        method: "GET",
        url: `/api/v1/file/${idB}/download`,
        headers: authHeaders(),
      });
      expect(dl.statusCode).toBe(200);
    });

    it("deleting the LAST reference removes the blob", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${idB}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(await db.findOne(DIGITA.COLLECTIONS.FILE, idB, DIGITA.DATABASES.CORE)).toBeNull();
      await expect(access(join(uploadDir, ...sharedKey.split("/")))).rejects.toThrow();
    });
  });

  describe("edge cases", () => {
    it("returns 400 when no file part is sent", async () => {
      const boundary = "----digitaUploadTestBoundary";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: {
          ...authHeaders(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.from(`--${boundary}--\r\n`),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 for an unknown file id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/file/FILE-999999/download",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });

    it("serves legacy docs (file_url /uploads/<name>, no storage_key) from local storage", async () => {
      const legacyContent = Buffer.from("legacy file written before the StoragePort refactor");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(join(uploadDir, "legacy-test.txt"), legacyContent);
      await db.insertOne(
        DIGITA.COLLECTIONS.FILE,
        {
          _id: "FILE-900001",
          doctype: "file",
          docstatus: 0,
          file_name: "legacy.txt",
          file_url: "/uploads/legacy-test.txt",
          file_size: legacyContent.length,
          file_type: "text/plain",
          is_private: true,
          owner: "admin@digita.local",
          modified_by: "admin@digita.local",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/file/FILE-900001/download",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).equals(legacyContent)).toBe(true);
      expect(res.headers["content-type"]).toContain("text/plain");
    });
  });

  describe("RBAC — File entity permissions on the dedicated routes", () => {
    let adminFileId: string;
    let adminFileKey: string;
    let sharedFileId: string;
    const adminContent = Buffer.from("%PDF-1.4 admin-owned private attachment");

    it("setup: admin uploads a private file", async () => {
      const { payload, contentType } = multipartPayload("admin.pdf", "application/pdf", adminContent, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      adminFileId = res.json().data._id;
      adminFileKey = res.json().data.storage_key;
    });

    it("denies a non-owner System User the download of another user's file (403)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/file/${adminFileId}/download`,
        headers: authHeaders(salesToken),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("setup: admin attaches a private file to a doc a System User can read", async () => {
      await db.insertOne("TestShared", { _id: "SHARED-1", profile_image: "" }, "core");
      const { payload, contentType } = multipartPayload("shared.pdf", "application/pdf", Buffer.from("%PDF shared"), {
        attached_to_entity: "TestShared",
        attached_to_name: "SHARED-1",
        attached_to_field: "profile_image",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      sharedFileId = res.json().data._id;
    });

    it("ALLOWS a non-owner System User to download a private file on a doc they CAN read", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/file/${sharedFileId}/download`,
        headers: authHeaders(salesToken),
      });
      expect(res.statusCode).toBe(200);
    });

    it("re-checks target-entity write when REPLACING a PUBLIC file (403, content untouched)", async () => {
      // owner owns the File doc (File-write if_owner passes) but has no write on
      // TestCustomer (perms:[]); replacing a public, anonymously-served file must
      // be re-authorized against the target entity.
      await db.insertOne(
        DIGITA.COLLECTIONS.FILE,
        {
          _id: "FILE-900050",
          doctype: "file",
          docstatus: 0,
          file_name: "banner.png",
          file_url: "/api/v1/public/file/FILE-900050",
          file_type: "image/png",
          file_size: 3,
          storage_key: "customers/pubhash.png",
          storage_backend: "local",
          is_private: false,
          attached_to_entity: "TestCustomer",
          attached_to_field: "public_banner",
          owner: "owner@digita.local",
          modified_by: "owner@digita.local",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );
      const { payload, contentType } = multipartPayload("swap.png", "image/png", Buffer.from("new"));
      const res = await app.inject({
        method: "PUT",
        url: "/api/v1/file/FILE-900050",
        headers: { ...authHeaders(ownerToken), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(403);
      const stored = await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-900050", DIGITA.DATABASES.CORE);
      expect(stored?.["storage_key"]).toBe("customers/pubhash.png"); // untouched
    });

    it("denies a non-owner System User the content REPLACE of another user's file (403, bytes intact)", async () => {
      const { payload, contentType } = multipartPayload("swap.png", "image/png", Buffer.from("evil"));
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${adminFileId}`,
        headers: { ...authHeaders(salesToken), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(403);
      await expect(readFile(join(uploadDir, ...adminFileKey.split("/")))).resolves.toEqual(adminContent);
    });

    it("denies a non-owner System User the DELETE of another user's file (403, doc intact)", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${adminFileId}`,
        headers: authHeaders(salesToken),
      });
      expect(res.statusCode).toBe(403);
      const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, adminFileId, DIGITA.DATABASES.CORE);
      expect(doc).not.toBeNull();
    });

    it("denies a non-writer the upload of a PUBLIC attachment (403 — public-field authz)", async () => {
      // public_banner is a `public: true` field → anonymously served. A plain System
      // User with no write grant on TestCustomer must not be able to publish one.
      const up = multipartPayload("logo.png", "image/png", Buffer.from("not-a-real-png"), {
        attached_to_entity: "TestCustomer",
        attached_to_field: "public_banner",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(ownerToken), "content-type": up.contentType },
        payload: up.payload,
      });
      expect(res.statusCode).toBe(403);
    });

    it("lets the OWNER (plain System User) run the full lifecycle on their own file", async () => {
      // create
      const up = multipartPayload("mine.pdf", "application/pdf", Buffer.from("%PDF mine"), CTX);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(ownerToken), "content-type": up.contentType },
        payload: up.payload,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().data._id;
      expect(created.json().data.owner).toBe("owner@digita.local");

      // read
      const dl = await app.inject({
        method: "GET",
        url: `/api/v1/file/${id}/download`,
        headers: authHeaders(ownerToken),
      });
      expect(dl.statusCode).toBe(200);

      // replace
      const rep = multipartPayload("mine2.png", "image/png", Buffer.from("png-bytes-2"));
      const replaced = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${id}`,
        headers: { ...authHeaders(ownerToken), "content-type": rep.contentType },
        payload: rep.payload,
      });
      expect(replaced.statusCode).toBe(200);

      // delete
      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${id}`,
        headers: authHeaders(ownerToken),
      });
      expect(del.statusCode).toBe(200);
    });

    it("admin (Administrator role) bypasses if_owner and can delete the file", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/file/${adminFileId}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("public attachment fields (field.public opt-in)", () => {
    const bannerContent = Buffer.from("89504e47-public-banner-png-bytes", "utf8");
    let publicId: string;
    let publicUrl: string;
    let privateId: string;

    it("a field declaring public:true stores the file non-private with the public file_url", async () => {
      const { payload, contentType } = multipartPayload("banner.png", "image/png", bannerContent, {
        attached_to_entity: "TestCustomer",
        attached_to_name: "CUST-000001",
        attached_to_field: "public_banner",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.is_private).toBe(false);
      expect(body.data.file_url).toBe(`/api/v1/public/file/${body.data._id}`);
      publicId = body.data._id;
      publicUrl = body.data.file_url;
    });

    it("serves a public-field file to an ANONYMOUS request (no auth) with the exact bytes", async () => {
      const res = await app.inject({ method: "GET", url: publicUrl });
      expect(res.statusCode).toBe(200);
      expect(Buffer.from(res.rawPayload).equals(bannerContent)).toBe(true);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    });

    it("a normal (non-public) field stays private and is NOT served by the public route", async () => {
      const { payload, contentType } = multipartPayload("secret.png", "image/png", Buffer.from("secret"), {
        attached_to_entity: "TestCustomer",
        attached_to_name: "CUST-000001",
        attached_to_field: "profile_image",
      });
      const up = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(up.statusCode).toBe(201);
      expect(up.json().data.is_private).toBe(true);
      expect(up.json().data.file_url).toBe(`/api/v1/file/${up.json().data._id}/download`);
      privateId = up.json().data._id;

      // The anonymous public route hides private files behind a 404 (never 403).
      const pub = await app.inject({ method: "GET", url: `/api/v1/public/file/${privateId}` });
      expect(pub.statusCode).toBe(404);
    });

    it("cleanup: delete the public + private fixtures", async () => {
      await app.inject({ method: "DELETE", url: `/api/v1/file/${publicId}`, headers: authHeaders() });
      await app.inject({ method: "DELETE", url: `/api/v1/file/${privateId}`, headers: authHeaders() });
    });
  });

  describe("thumbnails (raster image uploads)", () => {
    let pngBig: Buffer;
    let imgId: string;
    let imgUrl: string;

    it("setup: generate a 320×240 PNG", async () => {
      const img = await new Promise<Jimp>((res, rej) =>
        new Jimp(320, 240, 0x3366ffff, (e, im) => (e ? rej(e) : res(im))),
      );
      pngBig = await img.getBufferAsync(Jimp.MIME_PNG);
      expect(pngBig.length).toBeGreaterThan(0);
    });

    it("an image upload gets a content-addressed thumbnail + ?thumb=1 url", async () => {
      const { payload, contentType } = multipartPayload("photo.png", "image/png", pngBig, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.thumbnail_key).toMatch(/^customers\/thumb-[0-9a-f]{64}\.png$/);
      expect(body.data.thumbnail_url).toBe(`/api/v1/file/${body.data._id}/download?thumb=1`);
      imgId = body.data._id;
      imgUrl = body.data.file_url;
    });

    it("?thumb=1 serves a smaller (<=256px) PNG; without it the original", async () => {
      const thumb = await app.inject({ method: "GET", url: `${imgUrl}?thumb=1`, headers: authHeaders() });
      expect(thumb.statusCode).toBe(200);
      expect(thumb.headers["content-type"]).toContain("image/png");
      const tImg = await Jimp.read(Buffer.from(thumb.rawPayload));
      expect(Math.max(tImg.getWidth(), tImg.getHeight())).toBeLessThanOrEqual(256);

      const full = await app.inject({ method: "GET", url: imgUrl, headers: authHeaders() });
      const fImg = await Jimp.read(Buffer.from(full.rawPayload));
      expect(fImg.getWidth()).toBe(320); // original untouched
    });

    it("a raster upload on a TWO-SEGMENT storage_path gets a thumbnail (no 500)", async () => {
      const { payload, contentType } = multipartPayload("logo.png", "image/png", pngBig, {
        attached_to_entity: "TestNested",
        attached_to_name: "N-1",
        attached_to_field: "logo",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      // 3-segment thumb key (web/branding/thumb-<hash>.png) stays within the cap.
      expect(res.json().data.thumbnail_key).toMatch(/^web\/branding\/thumb-[0-9a-f]{64}\.png$/);
    });

    it("a non-image upload gets no thumbnail", async () => {
      const { payload, contentType } = multipartPayload("doc.pdf", "application/pdf", pdfContent, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.thumbnail_key).toBeUndefined();
      await app.inject({ method: "DELETE", url: `/api/v1/file/${res.json().data._id}`, headers: authHeaders() });
    });

    it("cleanup: delete the image", async () => {
      await app.inject({ method: "DELETE", url: `/api/v1/file/${imgId}`, headers: authHeaders() });
    });
  });

  describe("stored-XSS hardening", () => {
    it("rejects image/svg+xml at upload even though it matches the image/* allow-list", async () => {
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`);
      const { payload, contentType } = multipartPayload("evil.svg", "image/svg+xml", svg, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("FILE_TYPE_NOT_ALLOWED");
      expect(res.json().error.detail).toContain("browser-executable");
    });

    it("rejects text/html at upload (deny-list, independent of the allow-list)", async () => {
      const html = Buffer.from("<script>fetch('//evil')</script>");
      const { payload, contentType } = multipartPayload("evil.html", "text/html", html, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("FILE_TYPE_NOT_ALLOWED");
    });

    it("neutralizes a stored text/html legacy doc on download (octet-stream + attachment)", async () => {
      // Hostile doc that predates the deny-list: the download route must not
      // echo the stored executable content-type back inline.
      const htmlContent = Buffer.from("<script>document.title='pwned'</script>");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(join(uploadDir, "legacy-evil.html"), htmlContent);
      await db.insertOne(
        DIGITA.COLLECTIONS.FILE,
        {
          _id: "FILE-900003",
          doctype: "file",
          docstatus: 0,
          file_name: "legacy-evil.html",
          file_url: "/uploads/legacy-evil.html",
          file_size: htmlContent.length,
          file_type: "text/html",
          is_private: true,
          owner: "admin@digita.local",
          modified_by: "admin@digita.local",
          creation: new Date(),
          modified: new Date(),
        },
        DIGITA.DATABASES.CORE,
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/file/FILE-900003/download",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/octet-stream");
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(Buffer.from(res.rawPayload).equals(htmlContent)).toBe(true);
    });

    it("serves allowed-but-not-render-safe types (docx) as attachment + octet-stream", async () => {
      const docx = Buffer.from("PK fake docx bytes");
      const { payload, contentType } = multipartPayload(
        "report.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docx,
        CTX,
      );
      const up = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(up.statusCode).toBe(201);
      const id = up.json().data._id;

      const dl = await app.inject({
        method: "GET",
        url: `/api/v1/file/${id}/download`,
        headers: authHeaders(),
      });
      expect(dl.statusCode).toBe(200);
      expect(dl.headers["content-type"]).toContain("application/octet-stream");
      expect(dl.headers["content-disposition"]).toMatch(/^attachment;.*report\.docx/);

      await app.inject({ method: "DELETE", url: `/api/v1/file/${id}`, headers: authHeaders() });
    });
  });

  describe("oversize uploads (UPLOAD_MAX_SIZE truncation guard)", () => {
    // env mock sets UPLOAD_MAX_SIZE=64kb — 128 KiB trips the multipart limit.
    const oversize = Buffer.alloc(128 * 1024, 0x42);

    it("POST refuses a truncated upload with 413 and leaves no blob behind", async () => {
      const before = await readdir(join(uploadDir, "customers")).catch(() => [] as string[]);
      const { payload, contentType } = multipartPayload("big.png", "image/png", oversize, CTX);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("FILE_TOO_LARGE");
      const after = await readdir(join(uploadDir, "customers")).catch(() => [] as string[]);
      expect(after.length).toBe(before.length);
    });

    it("PUT refuses a truncated replacement with 413 and keeps the intact original", async () => {
      const original = Buffer.from("%PDF-1.4 the only good copy");
      const up = multipartPayload("good.pdf", "application/pdf", original, CTX);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": up.contentType },
        payload: up.payload,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().data._id;
      const key = created.json().data.storage_key;

      const rep = multipartPayload("big.png", "image/png", oversize);
      const res = await app.inject({
        method: "PUT",
        url: `/api/v1/file/${id}`,
        headers: { ...authHeaders(), "content-type": rep.contentType },
        payload: rep.payload,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe("FILE_TOO_LARGE");

      // Doc still points at the original key, bytes untouched.
      const doc = await db.findOne(DIGITA.COLLECTIONS.FILE, id, DIGITA.DATABASES.CORE);
      expect(doc?.["storage_key"]).toBe(key);
      await expect(readFile(join(uploadDir, ...key.split("/")))).resolves.toEqual(original);

      await app.inject({ method: "DELETE", url: `/api/v1/file/${id}`, headers: authHeaders() });
    });
  });

  describe("boot-time storage-path lint (DB-loaded definitions, hard failure)", () => {
    it("startup() rejects when a DB entity row declares Attach fields without storage_path", async () => {
      // Simulates a runtime meta-API edit (entity exists ONLY in the DB, no
      // file counterpart to carry storage_path forward from): the next boot
      // must fail loudly instead of silently accepting the offender.
      await db.insertOne(
        DIGITA.COLLECTIONS.ENTITY,
        {
          _id: "RuntimeBadEntity",
          name: "RuntimeBadEntity",
          module: "test",
          database: "core",
          label: "Runtime Bad Entity",
          naming: { strategy: "user_set" },
          fields: [{ fieldname: "doc", fieldtype: "Attach", label: "Doc" }],
          permissions: [],
        },
        DIGITA.DATABASES.CORE,
      );

      const second = await createApp({ authn: ta.authn });
      try {
        await expect(second.startup()).rejects.toThrow(/storage-path lint failed/);
      } finally {
        await second.app.close();
        await second.db.disconnect();
        await db.deleteOne(DIGITA.COLLECTIONS.ENTITY, "RuntimeBadEntity", DIGITA.DATABASES.CORE);
      }
    }, 60000);
  });
});
