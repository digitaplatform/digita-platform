import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("../src/core/config/build-version.js", () => ({
  BUILD_VERSION: "0.4.1",
  getBuildInfo: () => ({ name: "digita-platform", version: "0.4.001-stable-20261003220000-abcdef0", subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1" }] }),
}));

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

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import type { FastifyInstance } from "fastify";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";

let replSet: ReplicaFixture;
let app: FastifyInstance;
let db: MongoDBService;
let sign: Awaited<ReturnType<typeof buildTestAuth>>["sign"];

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  const ta = await buildTestAuth();
  sign = ta.sign;
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
}, 30000);

describe("Boot API Integration", () => {
  describe("GET /api/v1/boot", () => {
    it("returns boot data without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      // Anonymous: no grants; only the open `anonymous` tier is enterable.
      expect(body.data.audience.grants).toEqual([]);
      expect(body.data.audience.can_enter.anonymous).toBe(true);
      expect(body.data.audience.can_enter.internal).toBe(false);
      expect(body.data.audience.can_enter.external).toBe(false);
    });

    it("returns user info with auth", async () => {
      const access_token = await sign({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.user).toBeDefined();
      expect(body.data.user.email).toBe("admin@digita.local");
    });

    it("resolves the locale from the token's language claim, ahead of Accept-Language", async () => {
      const access_token = await sign({
        sub: "de-profile@digita.local",
        email: "de-profile@digita.local",
        roles: ["System User"],
        language: "de",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}`, "accept-language": "en-US" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.user.language).toBe("de");
      expect(body.data.locale.code).toBe("de");
    });

    it("keeps each demo visitor's region on their own session, never on the demo user they share (#313)", async () => {
      // The shared demo user holds a region row, as one an earlier visitor would have left.
      await db.insertOne(
        DIGITA.COLLECTIONS.USER_PREFERENCE,
        { _id: "demo-locale", owner: "demo@show.test", pref_key: "locale", value: JSON.stringify({ format_locale: "fr-CH", timezone: "Asia/Tokyo" }) },
        DIGITA.DATABASES.CORE,
      );
      const visitor = (extra: Record<string, unknown>) =>
        sign({ sub: "demo@show.test", email: "demo@show.test", roles: ["System User"], language: "de", extra: { demo: true, ...extra } });
      const boot = async (token: string) =>
        (await app.inject({ method: "GET", url: "/api/v1/boot", headers: { authorization: `Bearer ${token}` } })).json().data;

      const chose = await boot(await visitor({ format_locale: "de-CH", timezone: "Europe/Zurich" }));
      const other = await boot(await visitor({}));

      expect(chose.user.demo).toBe(true);
      expect([chose.locale.format_locale, chose.locale.timezone]).toEqual(["de-CH", "Europe/Zurich"]);
      expect([other.locale.format_locale, other.locale.timezone]).toEqual(["de", null]);

      // A person who is no demo visitor keeps their stored region, and /boot names no demo.
      const own = await boot(await sign({ sub: "demo@show.test", email: "demo@show.test", roles: ["System User"], language: "de" }));
      expect(own.user.demo).toBeUndefined();
      expect([own.locale.format_locale, own.locale.timezone]).toEqual(["fr-CH", "Asia/Tokyo"]);
    });

    it("names the text direction of each language it offers", async () => {
      await db.insertOne(
        DIGITA.COLLECTIONS.LANGUAGE,
        { _id: "ar", name: "Arabic", native_name: "العربية", enabled: true, direction: "rtl" },
        DIGITA.DATABASES.CORE,
      );
      try {
        const res = await app.inject({ method: "GET", url: "/api/v1/boot" });

        expect(res.statusCode).toBe(200);
        const languages = res.json().data.available_languages as { code: string; direction: string }[];
        expect(languages.find((l) => l.code === "ar")?.direction).toBe("rtl");
        expect(languages.find((l) => l.code === "en")?.direction).toBe("ltr");
      } finally {
        await db.deleteOne(DIGITA.COLLECTIONS.LANGUAGE, "ar", DIGITA.DATABASES.CORE);
      }
    });

    it("surfaces the token's `tiers` audience-set and the canEnter verdict (ADR-A1)", async () => {
      const access_token = await sign({
        sub: "dual@digita.local",
        email: "dual@digita.local",
        roles: ["Administrator"],
        tiers: ["internal", "external"],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.user.tiers).toEqual(["internal", "external"]);
      expect(body.data.audience.grants).toEqual(["internal", "external"]);
      expect(body.data.audience.can_enter.internal).toBe(true);
      expect(body.data.audience.can_enter.external).toBe(true);
      expect(body.data.audience.can_enter.anonymous).toBe(true);
    });

    it("reports no grants for a token with an empty tier-set (boot does not fabricate a set)", async () => {
      const access_token = await sign({
        sub: "legacy@digita.local",
        email: "legacy@digita.local",
        roles: ["System User"],
        tiers: [],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      const body = res.json();
      // Empty/absent set ⇒ [] grants surfaced; /boot never fabricates a tier.
      // (Enforcement — no token issued without a tier — is on the auth side.)
      expect(body.data.audience.grants).toEqual([]);
      expect(body.data.audience.can_enter.internal).toBe(false);
    });

    it("filters malformed/unknown tier values (never 500s)", async () => {
      const access_token = await sign({
        sub: "garbage@digita.local",
        email: "garbage@digita.local",
        roles: ["System User"],
        tiers: ["internal", "bogus", "internal"],
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/boot",
        headers: { authorization: `Bearer ${access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Unknown values dropped, duplicates deduped.
      expect(body.data.audience.grants).toEqual(["internal"]);
    });

    it("relays BrandingSetting.default_signature in the branding, and none while it is unset", async () => {
      const branding = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.branding;
      expect(await branding()).not.toHaveProperty("default_signature");

      await db.updateOne("BrandingSetting", "branding", { default_signature: "veloluck-workbench" }, "core");
      expect((await branding()).default_signature).toBe("veloluck-workbench");
    });

    it("PLANTED DEFECT: answers the app's name only when the tenant set one", async () => {
      const branding = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.branding;
      await db.updateOne("BrandingSetting", "branding", { app_name: null }, "core");
      expect(await branding()).not.toHaveProperty("app_name");

      await db.updateOne("BrandingSetting", "branding", { app_name: "Velo Luck GmbH" }, "core");
      expect((await branding()).app_name).toBe("Velo Luck GmbH");
      await db.updateOne("BrandingSetting", "branding", { app_name: null }, "core");
    });

    it("PLANTED DEFECT: answers no app's name for an empty one, so every page shows the look's name", async () => {
      const branding = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.branding;
      for (const empty of ["", "  "]) {
        await db.updateOne("BrandingSetting", "branding", { app_name: empty }, "core");
        expect(await branding(), JSON.stringify(empty)).not.toHaveProperty("app_name");
      }
      await db.updateOne("BrandingSetting", "branding", { app_name: null }, "core");
    });

    it("hands the tenant's time zone, whose day the form's __today__ names", async () => {
      const zone = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.system_settings.timezone;
      await db.updateOne("Setting", "settings", { timezone: "Europe/Zurich" }, "core");
      expect(await zone()).toBe("Europe/Zurich");
      await db.updateOne("Setting", "settings", { timezone: null }, "core");
      expect(await zone()).toBe("UTC");
    });

    it("relays no allow_user_template_override, which nothing reads, even from a row that still holds it", async () => {
      const branding = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.branding;
      await db.updateOne("BrandingSetting", "branding", { allow_user_template_override: false }, "core");
      expect(await branding()).not.toHaveProperty("allow_user_template_override");
    });

    it("relays BrandingSetting.web_default_signature to an anonymous caller, and none while it is unset", async () => {
      const branding = async () => (await app.inject({ method: "GET", url: "/api/v1/boot" })).json().data.branding;
      await db.updateOne("BrandingSetting", "branding", { web_default_signature: null }, "core");
      expect(await branding()).not.toHaveProperty("web_default_signature");

      await db.updateOne("BrandingSetting", "branding", { web_default_signature: "veloluck-lakeside" }, "core");
      expect((await branding()).web_default_signature).toBe("veloluck-lakeside");
    });
  });

  describe("GET /health", () => {
    it("returns only public metadata from the image, without requiring login", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ name: "digita-platform", version: "0.4.001-stable-20261003220000-abcdef0", subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1" }] });
      expect(res.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("GET /api/v1/meta", () => {
    it("returns entity list with auth", async () => {
      const access_token = await sign({
        sub: "admin@digita.local",
        email: "admin@digita.local",
        roles: ["Administrator", "System User"],
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/meta",
        headers: { authorization: `Bearer ${access_token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThan(0);
    });
  });
});
