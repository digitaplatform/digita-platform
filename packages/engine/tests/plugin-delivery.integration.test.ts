import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// Whole-env mock (same pattern as boot-api.integration.test.ts) with:
//  - APP_DIRS → a temp app dir holding ONLY a plugins.config.json (every other
//    app folder — entities/, rules/, views/, … — is optional and skipped),
//  - the checked-in dev-sample license + public key (entitles the four sample
//    premium designs) and the real staged premium artifact store.
vi.mock("../src/core/config/env.js", async () => {
  const { fileURLToPath } = await import("node:url");
  const { dirname, join, resolve } = await import("node:path");
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const appDir = mkdtempSync(join(tmpdir(), "digita-plugin-delivery-"));
  writeFileSync(
    join(appDir, "plugins.config.json"),
    JSON.stringify({
      plugins: [
        { id: "usermenu", title: "Navigation" },
        { id: "editorial", title: "Editorial" },
      ],
      layout: { template: "classic", regions: { header: "usermenu" } },
    }),
    "utf-8",
  );

  // tests/ → packages/engine → packages → monorepo root
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  // Premium artifact store: use the developer's real staged-premium/ when it has
  // been staged locally; otherwise (fresh checkout / CI, where staged-premium is
  // gitignored and absent) fabricate a minimal fixture so the gated delivery
  // route can be exercised hermetically — the route streams whatever bytes are on
  // disk, so a fixture proves the mechanism as well as the real artifact does.
  const realPremiumDir = join(repoRoot, "staged-premium");
  let premiumDir = realPremiumDir;
  if (!existsSync(join(realPremiumDir, "editorial", "0.1.0", "editorial.css"))) {
    premiumDir = mkdtempSync(join(tmpdir(), "digita-premium-"));
    mkdirSync(join(premiumDir, "editorial", "0.1.0"), { recursive: true });
    writeFileSync(
      join(premiumDir, "editorial", "0.1.0", "editorial.css"),
      "/* editorial design — test fixture (staged-premium absent) */\n",
      "utf-8",
    );
  }

  return { env: {
    NODE_ENV: "test", APP_VERSION: "0.1.0", SERVICE_NAME: "digita-test", PORT: 0, HOST: "127.0.0.1",
    BASE_URL: "http://localhost:3000", API_PREFIX: "/api/v1",
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
    LOG_LEVEL: "error", LOG_PRETTY: false, LOG_TO_FILE: false, LOG_FILE_PATH: "./logs",
    LOG_FILE_MAX_SIZE: "50M", LOG_FILE_MAX_FILES: 10, LOG_FILE_ROTATE: "daily",
    LOG_TO_MONGO: false, LOG_MONGO_TTL_DAYS: 30,
    LOG_REDACT_FIELDS: ["password", "secret", "token", "authorization"],
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
    APP_DIRS: [appDir], ENTITIES_DIR: "./src/entities", MODULES_DIR: "./src/modules", LOCALES_DIR: "./src/locales",
    AUTO_MIGRATE: true, TRACK_CHANGES_DEFAULT: false,
    // Typed plugin delivery — the checked-in sample license entitles the
    // premium designs editorial/fluent/ios/material.
    DIGITA_PLUGIN_LICENSE: "",
    DIGITA_PLUGIN_LICENSE_FILE: join(repoRoot, "tools", "plugin-mock", "dev-sample-license.jwt"),
    DIGITA_PLUGIN_LICENSE_PUBKEY_FILE: join(repoRoot, "tools", "plugin-mock", "keys", "dev-sample-ed25519-public.pem"),
    PLUGINS_PREMIUM_DIR: premiumDir,
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

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { FastifyInstance } from "fastify";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

let replSet: MongoMemoryReplSet;
let app: FastifyInstance;
let db: MongoDBService;
let token: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  token = await ta.sign({
    sub: "admin@digita.local",
    email: "admin@digita.local",
    roles: ["Administrator", "System User"],
  });
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  await result.startup();
  await app.ready();
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
  rmSync(env.APP_DIRS[0]!, { recursive: true, force: true });
}, 30000);

describe("Typed plugin delivery (engine runtime)", () => {
  describe("GET /api/v1/plugins — composition", () => {
    it("requires auth", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/plugins" });
      expect(res.statusCode).toBe(401);
    });

    it("returns { plugins:[{id,title?}], layout, entitlements } — no asset urls", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/plugins",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      // The merged plugins.config.json list, unchanged — ids + optional titles.
      expect(body.data.plugins).toEqual([
        { id: "usermenu", title: "Navigation" },
        { id: "editorial", title: "Editorial" },
      ]);
      // The host resolves urls from the /plugins/index.json inventory — the
      // composition must not carry any.
      expect(body.data.plugins.every((p: Record<string, unknown>) => !("url" in p))).toBe(true);
      // Opaque layout relayed verbatim.
      expect(body.data.layout).toEqual({ template: "classic", regions: { header: "usermenu" } });
      // Entitled premium ids from the verified dev-sample license.
      expect(body.data.entitlements).toEqual(["editorial", "fluent", "ios", "material"]);
    });
  });

  describe("GET /api/v1/plugin-assets/:id/:version/* — gated premium delivery", () => {
    it("requires auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/plugin-assets/editorial/0.1.0/editorial.css",
      });
      expect(res.statusCode).toBe(401);
    });

    it("streams an entitled artifact with text/css + immutable cache", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/plugin-assets/editorial/0.1.0/editorial.css",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/css; charset=utf-8");
      expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      // Byte-identical to the staged artifact.
      const staged = readFileSync(
        join(env.PLUGINS_PREMIUM_DIR, "editorial", "0.1.0", "editorial.css"),
        "utf-8",
      );
      expect(res.body).toBe(staged);
    });

    it("403s an id outside the entitlements (bytes never leave the server)", async () => {
      // "usermenu" is a real (free) plugin id but NOT in the license.
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/plugin-assets/usermenu/0.1.0/usermenu.js",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    });

    it("404s a missing file under an entitled id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/plugin-assets/editorial/0.1.0/nope.css",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("rejects path traversal (plain and encoded) without serving bytes", async () => {
      for (const url of [
        "/api/v1/plugin-assets/editorial/0.1.0/../../../package.json",
        "/api/v1/plugin-assets/editorial/0.1.0/..%2f..%2f..%2fpackage.json",
      ]) {
        const res = await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${token}` },
        });
        // Depending on router-level url handling this is a 400 (segment
        // validation) or 404 (no route) — never 200, never file bytes.
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.body).not.toContain('"name"');
      }
    });
  });
});
