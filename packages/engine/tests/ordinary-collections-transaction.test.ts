import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1,
    MONGODB_MAX_POOL: 5,
    MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users",
    MONGODB_LOGS_DB: "test_logs",
    MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import Fastify from "fastify";
import { DIGITA, type EntityDefinition } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { registerMetaRoutes } from "../src/core/api/meta-router.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { ConfigurationError } from "../src/core/errors/engine-error.js";
import { env } from "../src/core/config/env.js";

// Every entity collection participates in the caller's transaction.
let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("Ledger", "app"); // regular collection
  await db.ensureCollection("StockMovement", "app");
}, 60_000);

afterAll(async () => {
  await db?.disconnect();
  await replSet?.stop();
});

describe("MongoDBService — ordinary entity collections", () => {
  it("creates ordinary collections with enforceable unique values", async () => {
    const info = await db.getDb("app").listCollections({ name: "StockMovement" }).toArray();
    expect(info[0]?.type).toBe("collection");
    await db.createIndex("StockMovement", { code: 1 }, "app", { unique: true });
    await db.insertOne("StockMovement", { _id: "reserved", code: "RESERVED", deleted: new Date() }, "app");
    await expect(db.insertOne("StockMovement", { _id: "another", code: "RESERVED" }, "app")).rejects.toMatchObject({ code: 11000 });
  });

  it("commits entity and ledger writes together", async () => {
    await db.withTransaction(async (session) => {
      await db.insertOne("Ledger", { _id: "L-1", note: "in-transaction write" }, "app", session);
      await db.insertOne("StockMovement", { _id: "SM-1", code: "SM-1", posted_at: new Date(), warehouse: "WH-1", quantity: 5 }, "app", session);
    });
    expect(await db.findOne("StockMovement", "SM-1", "app")).not.toBeNull();
    expect(await db.findOne("Ledger", "L-1", "app")).not.toBeNull();
  });

  it("rolls back insertOne and insertMany with the surrounding transaction", async () => {
    await expect(db.withTransaction(async (session) => {
      await db.insertOne("StockMovement", { _id: "SM-2", code: "SM-2" }, "app", session);
      await db.insertMany("StockMovement", [{ _id: "SM-3", code: "SM-3" }], "app", session);
      await db.insertOne("Ledger", { _id: "L-2" }, "app", session);
      throw new Error("force abort");
    })).rejects.toThrow("force abort");
    expect(await db.findOne("StockMovement", "SM-2", "app")).toBeNull();
    expect(await db.findOne("StockMovement", "SM-3", "app")).toBeNull();
    expect(await db.findOne("Ledger", "L-2", "app")).toBeNull();
  });

  it("refuses an existing non-ordinary collection without changing its records", async () => {
    const raw = db.getDb("app");
    await raw.createCollection("ExistingNative", { timeseries: { timeField: "posted_at" } });
    await raw.collection("ExistingNative").insertOne({ posted_at: new Date(), quantity: 7 });
    await expect(db.ensureCollection("ExistingNative", "app")).rejects.toMatchObject({ code: "ordinary_collection_required" });
    expect(await raw.collection("ExistingNative").countDocuments()).toBe(1);
  });

  it("assertOrdinaryCollection returns true for ordinary collection, false for nonexistent, and throws ConfigurationError for non-ordinary", async () => {
    expect(await db.assertOrdinaryCollection("Ledger", "app")).toBe(true);
    expect(await db.assertOrdinaryCollection("NotYetCreated", "app")).toBe(false);
    await expect(db.assertOrdinaryCollection("ExistingNative", "app")).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("meta POST and PUT catch ConfigurationError and respond 400 before mutation", async () => {
    const metaApp = Fastify();
    metaApp.addHook("preHandler", async (request) => {
      (request as unknown as { user: unknown }).user = { email: "admin@d", roles: ["Administrator"] };
    });
    const registry = new EntityRegistry();
    const permissionChecker = new PermissionChecker(registry);
    registerMetaRoutes(metaApp, "/api/v1", registry, db, permissionChecker);
    await metaApp.ready();

    // POST /api/v1/meta for an entity mapped to a non-ordinary collection returns 400
    const postRes = await metaApp.inject({
      method: "POST",
      url: "/api/v1/meta",
      payload: {
        name: "ExistingNative",
        database: "app",
        module: "test",
        naming: { strategy: "user_set" },
        fields: [{ fieldname: "title", fieldtype: "Data" }],
      },
    });
    expect(postRes.statusCode).toBe(400);
    expect(postRes.json().messages[0].text).toBe("ordinary_collection_required");

    // Verify no row mutated/inserted in Entity collection
    const entityRow = await db.findOne(DIGITA.COLLECTIONS.ENTITY, "ExistingNative", DIGITA.DATABASES.CORE);
    expect(entityRow).toBeNull();

    // PUT /api/v1/meta/:doctype for an existing entity pointing to a non-ordinary collection returns 400
    registry.register({
      name: "ExistingNative",
      database: "app",
      module: "test",
      naming: { strategy: "user_set" },
      fields: [{ fieldname: "title", fieldtype: "Data" }],
    } as unknown as EntityDefinition);

    const putRes = await metaApp.inject({
      method: "PUT",
      url: "/api/v1/meta/ExistingNative",
      payload: { label: "Updated Label" },
    });
    expect(putRes.statusCode).toBe(400);
    expect(putRes.json().messages[0].text).toBe("ordinary_collection_required");

    await metaApp.close();
  });
});
