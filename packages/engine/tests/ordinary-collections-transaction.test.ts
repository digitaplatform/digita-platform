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
import { MongoDBService } from "../src/core/database/mongodb-service.js";
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
});
