import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", async () => {
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const uploadDir = join(tmpdir(), `digita-dt-it-${process.pid}-${Math.random().toString(36).slice(2)}`);
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
    UPLOAD_MAX_SIZE: "1mb", UPLOAD_STORAGE: "local", UPLOAD_LOCAL_PATH: uploadDir,
    UPLOAD_S3_BUCKET: "", UPLOAD_S3_REGION: "", UPLOAD_S3_ENDPOINT: "", UPLOAD_S3_KEY: "", UPLOAD_S3_SECRET: "",
    UPLOAD_ALLOWED_TYPES: ["image/*"],
    REALTIME_ENABLED: true, WS_PATH: "/ws", WS_PING_INTERVAL_MS: 25000,
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
import WebSocket from "ws";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { DIGITA } from "@digitaplatform/shared";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { createApp } from "../src/app.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { seedDataTranslations } from "../src/core/setup/seed-data-translations.js";
import { buildTestAuth } from "./_test-auth.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { EntityRegistry } from "../src/core/entity/entity-registry.js";

let replSet: ReplicaFixture;
let app: FastifyInstance;
let db: MongoDBService;
let registry: EntityRegistry;
let ta: Awaited<ReturnType<typeof buildTestAuth>>;
let token: string;

const ADMIN_PERMS = [{ role: "Administrator", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }];

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();

  ta = await buildTestAuth();
  const result = await createApp({ authn: ta.authn });
  app = result.app;
  db = result.db;
  registry = result.registry;
  await result.startup();
  await app.ready();

  // Fixture entities (registered post-startup; the read path resolves the registry
  // at request time). GlAcct has a translatable display field + GlRef links to it.
  registry.register({
    name: "GlAcct",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    title_field: "name",
    fields: [
      { fieldname: "code", fieldtype: "Data", label: "Code" },
      { fieldname: "name", fieldtype: "Data", label: "Name", translatable: true },
    ],
    permissions: ADMIN_PERMS,
  } as unknown as EntityDefinition);
  registry.register({
    name: "GlRef",
    module: "test",
    database: "core",
    naming: { strategy: "user_set" },
    fields: [{ fieldname: "acct", fieldtype: "Link", label: "Account", target: "GlAcct" }],
    permissions: ADMIN_PERMS,
  } as unknown as EntityDefinition);

  const now = new Date();
  const meta = { doctype: "gl", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now };
  // Two accounts; only A1 has translations (A2 → fallback to its stored name).
  await db.insertOne("GlAcct", { _id: "1200", code: "1200", name: "Accounts receivable", ...meta }, DIGITA.DATABASES.CORE);
  await db.insertOne("GlAcct", { _id: "1100", code: "1100", name: "Bank", ...meta }, DIGITA.DATABASES.CORE);
  await db.insertOne("GlRef", { _id: "R1", acct: "1200", ...meta }, DIGITA.DATABASES.CORE);

  // Data translations for account 1200 (de + it). None for 1100 / no "en".
  const tr = (locale: string, value: string) => ({
    _id: `data:${locale}:GlAcct.1200.name`,
    namespace: "data", locale, key: `GlAcct.1200.name`, value,
    entity: "GlAcct", document_name: "1200", fieldname: "name",
    source: "file", overridden: false, owner: "system", modified_by: "system", creation: now, modified: now,
  });
  await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, tr("de", "Forderungen aus Lieferungen und Leistungen"), DIGITA.DATABASES.CORE);
  await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, tr("it", "Crediti verso clienti"), DIGITA.DATABASES.CORE);

  token = await ta.sign({ sub: "admin@digita.local", email: "admin@digita.local", roles: ["Administrator", "System User"] });
}, 60000);

afterAll(async () => {
  await app.close();
  await db.disconnect();
  await replSet.stop();
}, 30000);

function get(url: string, locale?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (locale) headers["accept-language"] = locale;
  return app.inject({ method: "GET", url, headers });
}

describe("data-value translation on read", () => {
  it("getDoc returns the German name for an account with a de translation", async () => {
    const res = await get("/api/v1/resource/GlAcct/1200", "de");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("Forderungen aus Lieferungen und Leistungen");
    // Non-translatable field untouched.
    expect(res.json().data.code).toBe("1200");
  });

  it("getDoc returns the Italian name with Accept-Language: it", async () => {
    const res = await get("/api/v1/resource/GlAcct/1200", "it");
    expect(res.json().data.name).toBe("Crediti verso clienti");
  });

  it("falls back to the stored value when no translation exists (en / default)", async () => {
    const res = await get("/api/v1/resource/GlAcct/1200", "en");
    expect(res.json().data.name).toBe("Accounts receivable");
  });

  it("falls back per-row: an account with no translation keeps its stored name", async () => {
    const res = await get("/api/v1/resource/GlAcct", "de");
    const rows = res.json().data as Array<Record<string, string>>;
    const byId = Object.fromEntries(rows.map((r) => [r["_id"], r["name"]]));
    expect(byId["1200"]).toBe("Forderungen aus Lieferungen und Leistungen");
    expect(byId["1100"]).toBe("Bank"); // no de translation → stored value
  });

  it("translates the LINK TITLE of a selected account (getDoc)", async () => {
    const res = await get("/api/v1/resource/GlRef/R1", "de");
    expect(res.json().data._link_titles.acct).toBe("Forderungen aus Lieferungen und Leistungen");
  });

  it("translates the LINK TITLE in a list (batch)", async () => {
    const res = await get("/api/v1/resource/GlRef", "de");
    const row = (res.json().data as Array<Record<string, unknown>>).find((r) => r["_id"] === "R1")!;
    expect((row["_link_titles"] as Record<string, string>).acct).toBe(
      "Forderungen aus Lieferungen und Leistungen",
    );
  });
});

describe("a save in another language keeps the stored value of a translatable field (#160)", () => {
  beforeAll(async () => {
    const now = new Date();
    const meta = { doctype: "gl", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now };
    await db.insertOne("GlAcct", { _id: "1300", code: "1300", name: "Mystery", ...meta }, DIGITA.DATABASES.CORE);
    await db.insertOne(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        _id: "data:de:GlAcct.1300.name", namespace: "data", locale: "de", key: "GlAcct.1300.name", value: "Krimi",
        entity: "GlAcct", document_name: "1300", fieldname: "name", source: "file", overridden: false, ...meta,
      },
      DIGITA.DATABASES.CORE,
    );
  });

  function put(url: string, payload: Record<string, unknown>, locale: string) {
    return app.inject({
      method: "PUT",
      url,
      headers: { authorization: `Bearer ${token}`, "accept-language": locale },
      payload,
    });
  }

  it("sends back the German name it read and finds the stored name unchanged", async () => {
    const read = (await get("/api/v1/resource/GlAcct/1300", "de")).json().data;
    expect(read.name).toBe("Krimi");

    const res = await put("/api/v1/resource/GlAcct/1300", { code: "1300-A", name: read.name }, "de");
    expect(res.statusCode).toBe(200);

    const stored = (await db.findOne("GlAcct", "1300", DIGITA.DATABASES.CORE)) as Record<string, unknown>;
    expect(stored["name"]).toBe("Mystery");
    expect(stored["code"]).toBe("1300-A");
    // The form resets to the answer, so it shows the name a German read shows.
    expect(res.json().data.name).toBe("Krimi");
  });

  it("writes a name the user changed", async () => {
    const read = (await get("/api/v1/resource/GlAcct/1300", "en")).json().data;
    expect(read.name).toBe("Mystery");

    const res = await put("/api/v1/resource/GlAcct/1300", { code: read.code, name: "Crime" }, "en");
    expect(res.statusCode).toBe(200);

    const stored = (await db.findOne("GlAcct", "1300", DIGITA.DATABASES.CORE)) as Record<string, unknown>;
    expect(stored["name"]).toBe("Crime");
  });
});

describe("GET /resource/:entity/:name/translations is read-gated", () => {
  it("403s a caller with no read grant on the document's entity", async () => {
    const strangerTok = await ta.sign({ sub: "stranger@d", email: "stranger@d", roles: ["System User"] });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/resource/GlAcct/1200/translations",
      headers: { authorization: `Bearer ${strangerTok}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("answers a caller who may read the document with its data translations", async () => {
    const res = await get("/api/v1/resource/GlAcct/1200/translations");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.translations.de.name).toBe("Forderungen aus Lieferungen und Leistungen");
  });

  it("leaves out the translation of a field above the caller's read level", async () => {
    registry.register({
      name: "GlMemo",
      module: "test",
      database: "core",
      naming: { strategy: "user_set" },
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title", translatable: true },
        { fieldname: "memo", fieldtype: "Data", label: "Memo", translatable: true, perm_level: 1 },
      ],
      permissions: [...ADMIN_PERMS, { role: "System User", level: 0, select: 1, read: 1 }],
    } as unknown as EntityDefinition);
    const now = new Date();
    await db.insertOne(
      "GlMemo",
      { _id: "M1", title: "Rent", memo: "landlord owes a refund", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now },
      DIGITA.DATABASES.CORE,
    );
    for (const [fieldname, value] of [["title", "Miete"], ["memo", "Vermieter schuldet eine Erstattung"]]) {
      await db.insertOne(
        DIGITA.COLLECTIONS.TRANSLATION,
        {
          _id: `data:de:GlMemo.M1.${fieldname}`, namespace: "data", locale: "de", key: `GlMemo.M1.${fieldname}`, value,
          entity: "GlMemo", document_name: "M1", fieldname,
          source: "file", overridden: false, owner: "system", modified_by: "system", creation: now, modified: now,
        },
        DIGITA.DATABASES.CORE,
      );
    }
    const readerTok = await ta.sign({ sub: "reader@d", email: "reader@d", roles: ["System User"] });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/resource/GlMemo/M1/translations",
      headers: { authorization: `Bearer ${readerTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.translations.de).toEqual({ title: "Miete" });
  });

  it("gives a reader of level 1 the translation of the level-1 field too", async () => {
    // GlMemo and its translations come from the test above.
    registry.register({
      ...registry.get("GlMemo"),
      permissions: [...ADMIN_PERMS, { role: "System User", level: 0, select: 1, read: 1 }, { role: "Auditor", level: 1, read: 1 }],
    } as unknown as EntityDefinition);
    const auditorTok = await ta.sign({ sub: "auditor@d", email: "auditor@d", roles: ["System User", "Auditor"] });
    const res = await app.inject({ method: "GET", url: "/api/v1/resource/GlMemo/M1/translations", headers: { authorization: `Bearer ${auditorTok}` } });
    expect(res.json().data.translations.de).toEqual({ title: "Miete", memo: "Vermieter schuldet eine Erstattung" });
  });

  it("gives a reader only a share admits the level-0 translations, as getDoc shows them", async () => {
    const guestTok = await ta.sign({ sub: "guest@d", email: "guest@d", roles: ["Outsider"] });
    const now = new Date();
    await db.insertOne(
      DIGITA.COLLECTIONS.DOC_SHARE,
      { _id: "GlMemo:M1:guest@d", entity: "GlMemo", document_name: "M1", shared_with: "guest@d", can_read: 1, can_share: 0, shared_by: "system", owner: "system", modified_by: "system", creation: now, modified: now },
      DIGITA.DATABASES.IDENTITY,
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/resource/GlMemo/M1/translations", headers: { authorization: `Bearer ${guestTok}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.translations.de).toEqual({ title: "Miete" });
  });
});

// A data row is a document value: only an Administrator gets it from the locale
// route; every other reader gets it through the read-checked document and list routes.
describe("GET /translations/:locale keeps data rows from a caller who may not read them", () => {
  const strangerGet = async (url: string) => {
    const strangerTok = await ta.sign({ sub: "stranger@d", email: "stranger@d", roles: ["System User"] });
    return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${strangerTok}` } });
  };

  it("answers no GlAcct data row to a System User without a GlAcct grant (#74)", async () => {
    for (const url of ["/api/v1/translations/de", "/api/v1/translations/de?namespace=data&entity=GlAcct"]) {
      const res = await strangerGet(url);
      expect(res.json().data?.["GlAcct.1200.name"]).toBeUndefined();
    }
  });

  it("still answers the system and entity texts to that caller", async () => {
    for (const key of ["t74.greeting", "entity.GlAcct"]) {
      const put = await app.inject({
        method: "PUT",
        url: `/api/v1/translations/de/${key}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { value: `de ${key}` },
      });
      expect(put.statusCode).toBe(200);
    }
    const res = await strangerGet("/api/v1/translations/de");
    expect(res.json().data["t74.greeting"]).toBe("de t74.greeting");
    expect(res.json().data["entity.GlAcct"]).toBe("de entity.GlAcct");
    const scoped = await strangerGet("/api/v1/translations/de?namespace=entity");
    expect(scoped.json().data).toEqual({ "entity.GlAcct": "de entity.GlAcct" });
  });

  it("answers the data row to an Administrator", async () => {
    const res = await get("/api/v1/translations/de?namespace=data&entity=GlAcct");
    expect(res.json().data["GlAcct.1200.name"]).toBe("Forderungen aus Lieferungen und Leistungen");
  });

  it("refuses that caller the Translation rows on the resource and search routes (#74)", async () => {
    const urls = [
      `/api/v1/resource/Translation?filters=${encodeURIComponent(JSON.stringify([["namespace", "=", "data"]]))}`,
      "/api/v1/resource/Translation/data:de:GlAcct.1200.name",
      "/api/v1/search/Translation?q=Forderungen",
    ];
    const answers: Record<string, { status: number; leaks: boolean }> = {};
    for (const url of urls) {
      const res = await strangerGet(url);
      answers[url] = { status: res.statusCode, leaks: res.body.includes("GlAcct.1200.name") };
    }
    expect(answers).toEqual(Object.fromEntries(urls.map((url) => [url, { status: 403, leaks: false }])));
    expect((await strangerGet("/api/v1/resource/GlAcct/1200")).statusCode).toBe(403);
    expect((await get("/api/v1/resource/Translation/data:de:GlAcct.1200.name")).json().data.value).toBe(
      "Forderungen aus Lieferungen und Leistungen",
    );
  });
});

describe("seedDataTranslations (co-located *.translations.json)", () => {
  it("seeds data translations from a file so the read path applies them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "digita-dt-seed-"));
    // 1100 (Bank) has no translation yet; the file adds de + fr. A non-translatable
    // field ("code") and an unknown doc are ignored.
    await writeFile(
      join(dir, "GlAcct.translations.json"),
      JSON.stringify([
        { _id: "1100", field: "name", de: "Bank (DE)", fr: "Banque (FR)" },
        { _id: "1100", field: "code", de: "IGNORED" },
      ]),
      "utf-8",
    );

    await seedDataTranslations(db, registry, new TranslationService(db), [dir]);

    const de = await get("/api/v1/resource/GlAcct/1100", "de");
    expect(de.json().data.name).toBe("Bank (DE)");
    const fr = await get("/api/v1/resource/GlAcct/1100", "fr");
    expect(fr.json().data.name).toBe("Banque (FR)");
    // code is not translatable → original stored value, never the ignored row.
    expect(de.json().data.code).toBe("1100");
  });

  it("bulk endpoint writes data translations that the read path then applies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/translations/data/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        items: [
          { entity: "GlAcct", document_name: "1100", fieldname: "name", locale: "es", value: "Banco" },
          { entity: "GlAcct", document_name: "1100", fieldname: "name", locale: "tr", value: "Banka hesabı" },
          { entity: "GlAcct", document_name: "1100", fieldname: "name", locale: "it", value: "" }, // blank → skipped
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBe(2);

    const es = await app.inject({
      method: "GET",
      url: "/api/v1/resource/GlAcct/1100",
      headers: { authorization: `Bearer ${token}`, "accept-language": "es" },
    });
    expect(es.json().data.name).toBe("Banco");
  });

  /** Seeds one GlAcct translation file holding `rows`. */
  const seedFile = async (rows: Record<string, unknown>[]) => {
    const dir = await mkdtemp(join(tmpdir(), "digita-dt-reseed-"));
    try {
      await writeFile(join(dir, "GlAcct.translations.json"), JSON.stringify(rows), "utf-8");
      await seedDataTranslations(db, registry, new TranslationService(db), [dir]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("preserves a seeded translation edited through the resource API", async () => {
    const id = "data:fr:GlAcct.1200.name";
    await db.deleteMany(DIGITA.COLLECTIONS.TRANSLATION, { _id: id }, DIGITA.DATABASES.CORE);
    await seedFile([{ _id: "1200", field: "name", fr: "File value" }]);
    const response = await app.inject({
      method: "PUT", url: `/api/v1/resource/Translation/${encodeURIComponent(id)}`,
      headers: { authorization: `Bearer ${token}` }, payload: { value: "Administrator value" },
    });
    expect(response.statusCode).toBe(200);
    await seedFile([{ _id: "1200", field: "name", fr: "Corrected file value" }]);
    const row = await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, id, DIGITA.DATABASES.CORE);
    expect(row).toMatchObject({ value: "Administrator value", overridden: true, overridden_by: "admin@digita.local", original_value: "File value" });
  });

  it("preserves an Administrator edit made after the seed eligibility read", async () => {
    const id = "data:tr:GlAcct.1200.name";
    await db.deleteMany(DIGITA.COLLECTIONS.TRANSLATION, { _id: id }, DIGITA.DATABASES.CORE);
    await seedFile([{ _id: "1200", field: "name", tr: "File value" }]);
    const original = db.findOne.bind(db);
    let intercepted = false;
    const spy = vi.spyOn(db, "findOne").mockImplementation(async (...args) => {
      const row = await original(...args);
      if (!intercepted && args[0] === DIGITA.COLLECTIONS.TRANSLATION && args[1] === id) {
        intercepted = true;
        await new TranslationService(db).setTranslation({
          namespace: "data", locale: "tr", key: "GlAcct.1200.name", value: "Administrator value", user: "admin@digita.local",
        });
      }
      return row;
    });
    try {
      await seedFile([{ _id: "1200", field: "name", tr: "Corrected file value" }]);
    } finally {
      spy.mockRestore();
    }
    const row = await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, id, DIGITA.DATABASES.CORE);
    expect(row).toMatchObject({ value: "Administrator value", overridden: true, overridden_by: "admin@digita.local", original_value: "File value" });
  });

  it("PLANTED DEFECT: brings a corrected file value to a seeded translation nobody changed", async () => {
    // 1200's de row came from a file in beforeAll and nobody overrode it.
    await seedFile([{ _id: "1200", field: "name", de: "Forderungen (berichtigt)" }]);
    const de = await get("/api/v1/resource/GlAcct/1200", "de");
    expect(de.json().data.name).toBe("Forderungen (berichtigt)");
  });

  it("keeps an Administrator's edit when the file's value changes", async () => {
    await new TranslationService(db).setTranslation({
      namespace: "data", locale: "it", key: "GlAcct.1200.name", value: "Crediti (admin)", user: "admin@digita.local",
      entity: "GlAcct", document_name: "1200", fieldname: "name",
    });
    await seedFile([{ _id: "1200", field: "name", it: "Crediti (file nuovo)" }]);
    const it = await get("/api/v1/resource/GlAcct/1200", "it");
    expect(it.json().data.name).toBe("Crediti (admin)");
  });

  it("keeps a translation that did not come from a file", async () => {
    await new TranslationService(db).setTranslation({
      namespace: "data", locale: "es", key: "GlAcct.1100.name", value: "Banco", user: "admin@digita.local",
      entity: "GlAcct", document_name: "1100", fieldname: "name",
    });
    await seedFile([{ _id: "1100", field: "name", es: "Banco (file)" }]);
    const es = await get("/api/v1/resource/GlAcct/1100", "es");
    expect(es.json().data.name).toBe("Banco");
  });
});

describe("realtime WS gateway", () => {
  it("broadcasts a change event to a connected client after a write", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const events: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });
    ws.on("message", (data) => {
      events.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    const waitFor = (type: string) =>
      new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error(`ws ${type} timeout`)), 5000);
        const tick = setInterval(() => {
          if (events.some((m) => m["type"] === type)) {
            clearTimeout(to);
            clearInterval(tick);
            resolve();
          }
        }, 25);
        ws.on("error", (err) => {
          clearTimeout(to);
          clearInterval(tick);
          reject(err);
        });
      });

    await waitFor("ready");
    // Subscription-targeted: a client only receives change events for entities it
    // has declared it is viewing. Subscribe to GlAcct + await the ack before writing.
    ws.send(JSON.stringify({ type: "subscribe", entities: ["GlAcct"] }));
    await waitFor("subscribed");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/resource/GlAcct",
      headers: { authorization: `Bearer ${token}` },
      payload: { _id: "9001", code: "9001", name: "WS test" },
    });
    expect(created.statusCode).toBe(201);

    await vi.waitFor(
      () => {
        const hit = events.find(
          (m) => m["type"] === "change" && m["entity"] === "GlAcct" && m["name"] === "9001",
        );
        if (!hit) throw new Error("change event not received yet");
        expect(hit["op"]).toBe("insert");
      },
      { timeout: 5000, interval: 50 },
    );

    ws.close();
    await app.inject({
      method: "DELETE",
      url: "/api/v1/resource/GlAcct/9001",
      headers: { authorization: `Bearer ${token}` },
    });
  });

  it("rejects an unauthenticated WS connection (close 1008)", async () => {
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => {
      ws.on("close", (c: number) => resolve(c));
      ws.on("error", () => {}); // a rejected upgrade can also surface as error first
      setTimeout(() => resolve(-1), 5000);
    });
    expect(code).toBe(1008);
  });
});

describe("data translations are cleaned up on document delete", () => {
  const meta = { doctype: "gl", docstatus: 0, owner: "admin@digita.local", modified_by: "admin@digita.local", creation: new Date(), modified: new Date() };
  const dataTrans = () =>
    db.find(
      DIGITA.COLLECTIONS.TRANSLATION,
      { filters: [{ namespace: "data", entity: "GlAcct", document_name: "9999" }] },
      DIGITA.DATABASES.CORE,
    );

  it("deletes the doc's data-translation rows and does not resurrect them on _id reuse", async () => {
    await db.insertOne("GlAcct", { _id: "9999", code: "9999", name: "Temp", ...meta }, DIGITA.DATABASES.CORE);
    await db.insertOne(
      DIGITA.COLLECTIONS.TRANSLATION,
      {
        _id: "data:de:GlAcct.9999.name",
        namespace: "data", locale: "de", key: "GlAcct.9999.name", value: "Zeitweise",
        entity: "GlAcct", document_name: "9999", fieldname: "name", source: "user",
        overridden: false, creation: new Date(), modified: new Date(),
      },
      DIGITA.DATABASES.CORE,
    );
    // Sanity: the de overlay applies.
    const before = await get("/api/v1/resource/GlAcct/9999", "de");
    expect(before.json().data.name).toBe("Zeitweise");

    // Delete the document.
    const del = await app.inject({
      method: "DELETE",
      url: "/api/v1/resource/GlAcct/9999",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);

    // The orphan translation row is gone.
    expect((await dataTrans()).length).toBe(0);

    // Resurrection guard: a reused _id shows the stored value, not the stale overlay.
    await db.insertOne("GlAcct", { _id: "9999", code: "9999", name: "Fresh", ...meta }, DIGITA.DATABASES.CORE);
    const after = await get("/api/v1/resource/GlAcct/9999", "de");
    expect(after.json().data.name).toBe("Fresh");
  });
});
