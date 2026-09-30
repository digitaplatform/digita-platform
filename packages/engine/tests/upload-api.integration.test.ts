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
    BOOTSTRAP_LOCALE: "en", TRANSLATION_SOURCE: "file", TRANSLATION_CACHE: "none",
    TRANSLATION_CACHE_TTL_SEC: 0, TRANSLATION_SEED_ON_BOOT: false, TRANSLATION_FALLBACK_LOCALE: "en",
    API_RATE_LIMIT_MAX: 1000, API_RATE_LIMIT_WINDOW: "1m", API_MAX_BODY_SIZE: "10mb", API_TIMEOUT_MS: 60000,
    API_TRUSTED_PROXY_HOPS: 0, API_PUBLIC_CREATE_RATE_LIMIT_MAX: 1000, API_PUBLIC_CREATE_RATE_LIMIT_WINDOW: 60000,
    API_PUBLIC_CREATE_MAX_BODY_SIZE: "16kb",
    CORS_ORIGINS: ["*"], CORS_CREDENTIALS: true,
    // Small fileSize limit so the truncation guard is testable without MB payloads.
    UPLOAD_MAX_SIZE: "64kb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: uploadDir,
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*", "application/pdf", "application/vnd.openxmlformats-officedocument.*"],
    JOBS_ENABLED: false, JOBS_CONCURRENCY: 1, JOBS_RETRY_ATTEMPTS: 1, JOBS_RETRY_DELAY_MS: 1000,
    REALTIME_ENABLED: false, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
    IMPORT_MAX_ROWS: 100, EXPORT_MAX_ROWS: 100,
    APP_DIRS: [], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", TRANSLATIONS_DIR: process.env.TRANSLATIONS_DIR,
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
import { attachLegacyLooseFiles, attachLegacyLooseFilesOnce } from "../src/core/storage/legacy-file-attachment.js";

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
  // A parent whose read grant carries a condition on a Datetime field. The
  // stored row holds a Date; the row a reader gets holds an ISO string, and the
  // condition only holds on the latter.
  registry.register({
    name: "TestDue",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    storage_path: "due",
    fields: [
      { fieldname: "due", fieldtype: "Datetime", label: "Due" },
      { fieldname: "profile_image", fieldtype: "AttachImage", label: "Profile image" },
    ],
    permissions: [{ role: "System User", level: 0, read: 1, condition: "eval:doc.due >= '2026-01-01'" }],
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

    it("judges the parent's read condition on the row getDoc reads, not the stored row", async () => {
      await db.insertOne("TestDue", { _id: "DUE-2026", due: new Date("2026-06-01T00:00:00.000Z") }, "core");
      const { payload, contentType } = multipartPayload("due.pdf", "application/pdf", Buffer.from("%PDF due"), {
        attached_to_entity: "TestDue",
        attached_to_name: "DUE-2026",
        attached_to_field: "profile_image",
      });
      const upload = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(), "content-type": contentType },
        payload,
      });
      expect(upload.statusCode).toBe(201);

      const parent = await app.inject({
        method: "GET",
        url: "/api/v1/resource/TestDue/DUE-2026",
        headers: authHeaders(salesToken),
      });
      expect(parent.statusCode).toBe(200);
      const download = await app.inject({
        method: "GET",
        url: `/api/v1/file/${upload.json().data._id}/download`,
        headers: authHeaders(salesToken),
      });
      expect(download.statusCode).toBe(200);
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

  describe("a save attaches the app's uploads to the document (#139)", () => {
    let bookId: string;

    beforeAll(() => {
      // The uploader (owner) and the colleague (sales) are both plain System Users
      // who may read every book; the File grant alone lets only the uploader read.
      registry.register({
        name: "TestBook",
        module: "test",
        database: "core",
        naming: { strategy: "uuid" },
        storage_path: "books",
        fields: [
          { fieldname: "title", fieldtype: "Data", label: "Title" },
          { fieldname: "letter", fieldtype: "Attach", label: "Letter" },
          { fieldname: "pages", fieldtype: "Table", label: "Pages", child_fields: [{ fieldname: "scan", fieldtype: "Attach", label: "Scan" }] },
        ],
        permissions: [{ role: "System User", level: 0, select: 1, read: 1, write: 1, create: 1 }],
      } as unknown as EntityDefinition);
    });

    /** The call shape of the app's uploadFile: the entity and the field, never the document. */
    async function uploadAsApp(token: string, field: string, body: string) {
      const { payload, contentType } = multipartPayload(`${field}.pdf`, "application/pdf", Buffer.from(body), {
        attached_to_entity: "TestBook",
        attached_to_field: field,
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/upload",
        headers: { ...authHeaders(token), "content-type": contentType },
        payload,
      });
      expect(res.statusCode).toBe(201);
      return res.json().data as { _id: string; file_url: string };
    }

    function downloadAs(token: string, fileId: string) {
      return app.inject({ method: "GET", url: `/api/v1/file/${fileId}/download`, headers: authHeaders(token) });
    }

    /** A book as a row written before a save refused foreign files: the Administrator, who may
     *  read every file, creates it, and it is handed to the owner as its owner. */
    async function plantBook(ownerTokenOfRow: string, payload: Record<string, unknown>) {
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/resource/TestBook",
        headers: authHeaders(authToken),
        payload,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().data._id as string;
      const ownerEmail = ownerTokenOfRow === ownerToken ? "owner@digita.local" : "sales@digita.local";
      await db.updateOne("TestBook", id, { owner: ownerEmail }, "core");
      return created;
    }

    async function fileCount() {
      return db.count(DIGITA.COLLECTIONS.FILE, [], "core");
    }

    it("lets a reader of a new book open the files uploaded before its first save", async () => {
      const letter = await uploadAsApp(ownerToken, "letter", "%PDF new-book letter");
      const scan = await uploadAsApp(ownerToken, "scan", "%PDF new-book scan");
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/resource/TestBook",
        headers: authHeaders(ownerToken),
        payload: { title: "Dune", letter: letter.file_url, pages: [{ scan: scan.file_url }] },
      });
      expect(created.statusCode).toBe(201);
      bookId = created.json().data._id;

      expect((await downloadAs(salesToken, letter._id)).statusCode).toBe(200);
      expect((await downloadAs(salesToken, scan._id)).statusCode).toBe(200);
    });

    it("lets a reader of a saved book open a letter added in a later save", async () => {
      const letter = await uploadAsApp(ownerToken, "letter", "%PDF saved-book letter");
      const saved = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/TestBook/${bookId}`,
        headers: authHeaders(ownerToken),
        payload: { letter: letter.file_url },
      });
      expect(saved.statusCode).toBe(200);

      expect((await downloadAs(salesToken, letter._id)).statusCode).toBe(200);
    });

    it("lets a reader of a copied book open the copy's own letter", async () => {
      const copied = await app.inject({
        method: "POST",
        url: `/api/v1/resource/TestBook/${bookId}/copy`,
        headers: authHeaders(ownerToken),
      });
      expect(copied.statusCode).toBe(201);
      const copyLetterId = /\/file\/([^/]+)\/download/.exec(copied.json().data.letter as string)![1]!;

      expect((await downloadAs(salesToken, copyLetterId)).statusCode).toBe(200);
    });

    it("refuses a save that names another user's upload, so it stays unattached and theirs", async () => {
      const foreign = await uploadAsApp(salesToken, "letter", "%PDF sales-owned letter");
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/resource/TestBook",
        headers: authHeaders(ownerToken),
        payload: { title: "Emma", letter: foreign.file_url },
      });
      expect(created.statusCode).toBe(403);

      const row = (await db.findOne(DIGITA.COLLECTIONS.FILE, foreign._id, "core")) as Record<string, unknown>;
      expect(row["attached_to_name"]).toBeUndefined();
      expect((await downloadAs(ownerToken, foreign._id)).statusCode).toBe(403);
    });

    it("binds no upload of another user when an Administrator saves the record that names it", async () => {
      // The owner names a colleague's loose upload in their own book; an Administrator, who may
      // write every File, then saves the book as the app does, with every field.
      // A save of the owner's cannot name it any more; the book is planted as a row written
      // before that refusal existed.
      const foreign = await uploadAsApp(salesToken, "letter", "%PDF sales-owned letter, admin save");
      const created = await plantBook(ownerToken, { title: "Persuasion", letter: foreign.file_url });
      expect(created.statusCode).toBe(201);
      const book = created.json().data as { _id: string };
      const saved = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/TestBook/${book._id}`,
        headers: authHeaders(authToken),
        payload: { title: "Persuasion, approved", letter: foreign.file_url },
      });
      expect(saved.statusCode).toBe(200);

      const row = (await db.findOne(DIGITA.COLLECTIONS.FILE, foreign._id, "core")) as Record<string, unknown>;
      expect(row["attached_to_name"]).toBeUndefined();
      expect((await downloadAs(ownerToken, foreign._id)).statusCode).toBe(403);
    });

    it("refuses to copy a book that names a file the copier may not read, and clones nothing", async () => {
      const foreign = await uploadAsApp(salesToken, "letter", "%PDF sales-owned letter, copy");
      const planted = await plantBook(ownerToken, { title: "Mansfield Park", letter: foreign.file_url });
      const before = await fileCount();
      const copied = await app.inject({
        method: "POST",
        url: `/api/v1/resource/TestBook/${planted.json().data._id}/copy`,
        headers: authHeaders(ownerToken),
      });
      expect(copied.statusCode).toBe(403);
      expect(await fileCount()).toBe(before);
    });

    it("deletes no foreign file when a save clears the field that names it", async () => {
      const foreign = await uploadAsApp(salesToken, "letter", "%PDF sales-owned letter, clear");
      const planted = await plantBook(ownerToken, { title: "Lady Susan", letter: foreign.file_url });
      const cleared = await app.inject({
        method: "PUT",
        url: `/api/v1/resource/TestBook/${planted.json().data._id}`,
        headers: authHeaders(ownerToken),
        payload: { letter: null },
      });
      expect(cleared.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await db.findOne(DIGITA.COLLECTIONS.FILE, foreign._id, "core")).not.toBeNull();
      expect((await downloadAs(salesToken, foreign._id)).statusCode).toBe(200);
    });

    it("binds a user's own upload when the token's sub is an id, not the email", async () => {
      const idToken = await ta.sign({ sub: "user-id-0042", email: "owner@digita.local", roles: ["System User"] });
      const letter = await uploadAsApp(idToken, "letter", "%PDF id-token letter");
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/resource/TestBook",
        headers: authHeaders(idToken),
        payload: { title: "The Watsons", letter: letter.file_url },
      });
      expect(created.statusCode).toBe(201);
      expect((await downloadAs(salesToken, letter._id)).statusCode).toBe(200);
    });

    it("binds the Administrator's own upload when the Administrator saves (innocent case)", async () => {
      const own = await uploadAsApp(authToken, "letter", "%PDF admin-owned letter");
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/resource/TestBook",
        headers: authHeaders(authToken),
        payload: { title: "Sanditon", letter: own.file_url },
      });
      expect(created.statusCode).toBe(201);
      const row = (await db.findOne(DIGITA.COLLECTIONS.FILE, own._id, "core")) as Record<string, unknown>;
      expect(row["attached_to_name"]).toBe(created.json().data._id);
    });

    describe("a record that names a file it does not own", () => {
      beforeAll(() => {
        // A note is its owner's only; it may name any file its owner may read.
        registry.register({
          name: "TestNote",
          module: "test",
          database: "core",
          naming: { strategy: "uuid" },
          storage_path: "notes",
          fields: [
            { fieldname: "title", fieldtype: "Data", label: "Title" },
            { fieldname: "letter", fieldtype: "Attach", label: "Letter" },
            { fieldname: "rows", fieldtype: "Table", label: "Rows", child_fields: [{ fieldname: "scan", fieldtype: "Attach", label: "Scan" }] },
          ],
          permissions: [{ role: "System User", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, import: 1, if_owner: true }],
        } as unknown as EntityDefinition);
      });

      /** A letter the colleague uploaded and bound to their own book, which every System User may read. */
      async function salesBookWithLetter(body: string) {
        const letter = await uploadAsApp(salesToken, "letter", body);
        const created = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestBook",
          headers: authHeaders(salesToken),
          payload: { title: "Sales book", letter: letter.file_url },
        });
        expect(created.statusCode).toBe(201);
        const row = (await db.findOne(DIGITA.COLLECTIONS.FILE, letter._id, "core")) as Record<string, unknown>;
        expect(row["attached_to_name"]).toBe(created.json().data._id);
        return { letter, bookId: created.json().data._id as string };
      }

      /** The id the next upload gets: file ids are sequential. */
      async function nextFileId() {
        const probe = await uploadAsApp(ownerToken, "letter", `%PDF probe ${Math.random()}`);
        return `FILE-${String(Number(probe._id.slice(5)) + 1).padStart(6, "0")}`;
      }

      function deleteNote(token: string, id: string) {
        return app.inject({ method: "DELETE", url: `/api/v1/resource/TestNote/${id}`, headers: authHeaders(token) });
      }

      /** The delete's cleanup runs once its transaction has committed, after the response. */
      const cleanupDone = () => new Promise((resolve) => setTimeout(resolve, 100));

      it("keeps a colleague's letter bound to their book when a reader deletes a note that names it", async () => {
        const { letter } = await salesBookWithLetter("%PDF sales book letter, note deleted");
        const note = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestNote",
          headers: authHeaders(ownerToken),
          payload: { title: "mine", letter: letter.file_url },
        });
        expect(note.statusCode).toBe(201);
        expect((await deleteNote(ownerToken, note.json().data._id)).statusCode).toBe(200);
        await cleanupDone();
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, letter._id, "core")).not.toBeNull();
      });

      it("refuses a save that names a file id no upload has yet, and a note that named one deletes nothing", async () => {
        const futureId = await nextFileId();
        const futureUrl = `/api/v1/file/${futureId}/download`;
        const refused = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestNote",
          headers: authHeaders(ownerToken),
          payload: { title: "future", letter: futureUrl },
        });
        expect(refused.statusCode).toBe(403);

        // A note saved before the refusal existed.
        const note = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestNote",
          headers: authHeaders(ownerToken),
          payload: { title: "future, planted" },
        });
        await db.updateOne("TestNote", note.json().data._id, { letter: futureUrl }, "core");
        const later = await uploadAsApp(salesToken, "letter", "%PDF sales later upload");
        expect(later._id).toBe(futureId);
        expect((await deleteNote(ownerToken, note.json().data._id)).statusCode).toBe(200);
        await cleanupDone();
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, later._id, "core")).not.toBeNull();
      });

      it("keeps the clone the colleague's when an Administrator copies a record naming the colleague's loose file", async () => {
        const secret = await uploadAsApp(salesToken, "letter", "%PDF sales secret");
        const planted = await plantBook(ownerToken, { title: "Bait", letter: secret.file_url });
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${planted.json().data._id}/copy`,
          headers: authHeaders(authToken),
        });
        expect(copied.statusCode).toBe(201);
        const cloneId = /\/file\/([^/]+)\/download/.exec(copied.json().data.letter as string)![1]!;
        expect(cloneId).not.toBe(secret._id);

        expect((await downloadAs(ownerToken, cloneId)).statusCode).toBe(403);
        expect((await downloadAs(salesToken, cloneId)).statusCode).toBe(200);
      });

      it("keeps the source's colleague file when its uploader clears it in an Administrator's copy", async () => {
        const letter = await uploadAsApp(salesToken, "letter", "%PDF sales loose letter, copied by admin");
        const planted = await plantBook(ownerToken, { title: "Pride", letter: letter.file_url });
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${planted.json().data._id}/copy`,
          headers: authHeaders(authToken),
        });
        expect(copied.statusCode).toBe(201);
        const cleared = await app.inject({
          method: "PUT",
          url: `/api/v1/resource/TestBook/${copied.json().data._id}`,
          headers: authHeaders(salesToken),
          payload: { letter: null },
        });
        expect(cleared.statusCode).toBe(200);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, letter._id, "core")).not.toBeNull();
        expect((await downloadAs(salesToken, letter._id)).statusCode).toBe(200);
      });

      it("leaves no clone behind when the insert refuses a copy", async () => {
        const own = await uploadAsApp(ownerToken, "letter", "%PDF owner letter, refused copy");
        const foreign = await uploadAsApp(salesToken, "scan", "%PDF sales scan, refused copy");
        const planted = await plantBook(ownerToken, { title: "Northanger", letter: own.file_url, pages: [{ scan: foreign.file_url }] });
        const before = await fileCount();
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${planted.json().data._id}/copy`,
          headers: authHeaders(ownerToken),
        });
        expect(copied.statusCode).toBe(403);
        expect(await fileCount()).toBe(before);
      });

      it("lets a colleague's copy of a book own the clone of the letter bound to it (innocent case)", async () => {
        const { bookId } = await salesBookWithLetter("%PDF sales book letter, copied");
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${bookId}/copy`,
          headers: authHeaders(ownerToken),
        });
        expect(copied.statusCode).toBe(201);
        const cloneId = /\/file\/([^/]+)\/download/.exec(copied.json().data.letter as string)![1]!;
        expect((await downloadAs(ownerToken, cloneId)).statusCode).toBe(200);
      });

      it("copies a book whose letter's File is gone, and drops the ref that names nothing", async () => {
        const letter = await uploadAsApp(ownerToken, "letter", "%PDF letter, File gone");
        const created = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestBook",
          headers: authHeaders(ownerToken),
          payload: { title: "Gone", letter: letter.file_url },
        });
        await db.deleteOne(DIGITA.COLLECTIONS.FILE, letter._id, "core");
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${created.json().data._id}/copy`,
          headers: authHeaders(ownerToken),
        });
        expect(copied.statusCode).toBe(201);
        expect(copied.json().data.letter ?? null).toBeNull();
      });

      it("binds the copier's own loose upload to the copy, when the token's sub is an id (innocent case)", async () => {
        const idToken = await ta.sign({ sub: "user-id-0044", email: "owner@digita.local", roles: ["System User"] });
        const own = await uploadAsApp(idToken, "letter", "%PDF id-token letter, copied");
        const planted = await plantBook(ownerToken, { title: "Own, loose", letter: own.file_url });
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${planted.json().data._id}/copy`,
          headers: authHeaders(idToken),
        });
        expect(copied.statusCode).toBe(201);
        const cloneId = /\/file\/([^/]+)\/download/.exec(copied.json().data.letter as string)![1]!;
        expect((await downloadAs(salesToken, cloneId)).statusCode).toBe(200);
      });

      it("lets a reader name a file bound to a book they may read, in a new note and a later save (innocent case)", async () => {
        const { letter } = await salesBookWithLetter("%PDF sales book letter, referenced");
        const note = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestNote",
          headers: authHeaders(ownerToken),
          payload: { title: "ref", rows: [{ scan: letter.file_url }] },
        });
        expect(note.statusCode).toBe(201);
        const saved = await app.inject({
          method: "PUT",
          url: `/api/v1/resource/TestNote/${note.json().data._id}`,
          headers: authHeaders(ownerToken),
          payload: { letter: letter.file_url },
        });
        expect(saved.statusCode).toBe(200);
      });

      it("deletes the deleter's own loose upload with the note, when the token's sub is an id (innocent case)", async () => {
        const idToken = await ta.sign({ sub: "user-id-0043", email: "owner@digita.local", roles: ["System User"] });
        // Uploaded for a book, so a note's save does not bind it: it stays its uploader's loose file.
        const own = await uploadAsApp(idToken, "letter", "%PDF id-token letter, note deleted");
        const note = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestNote",
          headers: authHeaders(idToken),
          payload: { title: "own", letter: own.file_url },
        });
        expect(note.statusCode).toBe(201);
        expect((await deleteNote(idToken, note.json().data._id)).statusCode).toBe(200);
        await cleanupDone();
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, own._id, "core")).toBeNull();
      });

      it("reports in an import's dry run the file its real run refuses", async () => {
        const foreign = await uploadAsApp(salesToken, "letter", "%PDF sales letter, imported");
        const importAs = (mode: string) =>
          app.inject({
            method: "POST",
            url: "/api/v1/import/TestNote",
            headers: authHeaders(ownerToken),
            payload: { mode, rows: [{ title: "imported", letter: foreign.file_url }] },
          });
        const dryRun = (await importAs("validate")).json().data;
        const realRun = (await importAs("insert")).json().data;
        expect(realRun.failed).toBe(1);
        expect(dryRun.failed).toBe(1);
        expect(dryRun.errors[0].message).toBe(realRun.errors[0].message);
      });

      it("lets a colleague copy a book whose legacy loose letter the migration attached to it", async () => {
        const letter = await uploadAsApp(ownerToken, "letter", "%PDF legacy letter, L1");
        const created = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestBook",
          headers: authHeaders(ownerToken),
          payload: { title: "legacy", letter: letter.file_url },
        });
        expect(created.statusCode).toBe(201);
        // As a save before uploads were attached left it: the File names no document.
        await db.updateOne(DIGITA.COLLECTIONS.FILE, letter._id, { attached_to_name: null }, "core");
        await attachLegacyLooseFiles(db, registry.getAll());
        const copied = await app.inject({
          method: "POST",
          url: `/api/v1/resource/TestBook/${created.json().data._id}/copy`,
          headers: authHeaders(salesToken),
        });
        expect(copied.statusCode).toBe(201);
      });

      it("deletes a legacy loose letter the migration attached, when a colleague clears it", async () => {
        const letter = await uploadAsApp(ownerToken, "letter", "%PDF legacy letter, L2");
        const created = await app.inject({
          method: "POST",
          url: "/api/v1/resource/TestBook",
          headers: authHeaders(ownerToken),
          payload: { title: "legacy2", letter: letter.file_url },
        });
        await db.updateOne(DIGITA.COLLECTIONS.FILE, letter._id, { attached_to_name: null }, "core");
        await attachLegacyLooseFiles(db, registry.getAll());
        const cleared = await app.inject({
          method: "PUT",
          url: `/api/v1/resource/TestBook/${created.json().data._id}`,
          headers: authHeaders(salesToken),
          payload: { letter: null },
        });
        expect(cleared.statusCode).toBe(200);
        await cleanupDone();
        expect(await db.findOne(DIGITA.COLLECTIONS.FILE, letter._id, "core")).toBeNull();
      });
    });

    describe("the migration of legacy loose uploads", () => {
      async function attachedTo(fileId: string) {
        return ((await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, "core")) as Record<string, unknown>)["attached_to_name"];
      }

      it("attaches a loose upload to the one record of its uploader that names it, and nothing else", async () => {
        // The files the earlier tests left loose are counted in `settled`.
        const settled = await attachLegacyLooseFiles(db, registry.getAll());
        // Legacy state: an Administrator's save attaches nothing of the owner's, so each file stays
        // as a save before uploads were attached left it, with no document named.
        const letter = await uploadAsApp(ownerToken, "letter", "%PDF legacy letter");
        const scan = await uploadAsApp(ownerToken, "scan", "%PDF legacy scan");
        const shared = await uploadAsApp(ownerToken, "letter", "%PDF legacy letter, named twice");
        const foreign = await uploadAsApp(salesToken, "letter", "%PDF legacy letter, a colleague's");
        const book = await plantBook(ownerToken, { title: "Legacy", letter: letter.file_url, pages: [{ scan: scan.file_url }] });
        await plantBook(ownerToken, { title: "Twice, one", letter: shared.file_url });
        await plantBook(ownerToken, { title: "Twice, two", letter: shared.file_url });
        await plantBook(ownerToken, { title: "Planted", letter: foreign.file_url });
        for (const file of [letter, scan, shared, foreign]) expect(await attachedTo(file._id)).toBeUndefined();

        const first = await attachLegacyLooseFiles(db, registry.getAll());
        expect(first).toEqual({
          attached: 2,
          named_by_several: settled.named_by_several + 1,
          named_by_other_owner: settled.named_by_other_owner + 1,
        });
        expect(await attachedTo(letter._id)).toBe(book.json().data._id);
        expect(await attachedTo(scan._id)).toBe(book.json().data._id);
        expect(await attachedTo(shared._id)).toBeUndefined();
        expect(await attachedTo(foreign._id)).toBeUndefined();
        expect((await downloadAs(salesToken, letter._id)).statusCode).toBe(200);
        expect((await downloadAs(ownerToken, foreign._id)).statusCode).toBe(403);

        expect(await attachLegacyLooseFiles(db, registry.getAll())).toEqual({ ...first, attached: 0 });
      });

      it("ran once at boot, so a later boot attaches nothing", async () => {
        expect(await db.findOne("_migrations", "attach-legacy-loose-files", "core")).not.toBeNull();
        const letter = await uploadAsApp(ownerToken, "letter", "%PDF letter after the migration");
        await plantBook(ownerToken, { title: "After", letter: letter.file_url });
        await attachLegacyLooseFilesOnce(db, registry.getAll());
        expect(await attachedTo(letter._id)).toBeUndefined();
      });
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
