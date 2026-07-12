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

/**
 * Regression guard for B1 (2026-07-11): a native MongoDB time-series collection
 * CANNOT be written inside a multi-document transaction — a real MongoDB 8.0
 * replica set rejects it with server code 263 (OperationNotSupportedInTransaction),
 * even at FCV 8.0. Stock movements are append-only rows written from `on_submit`
 * hooks that run inside the submit transaction, so every stock-side submit
 * (delivery / receipt / stocktake / credit-note reversal) 500'd on the real
 * cluster while passing against the in-memory server.
 *
 * The fix routes time-series writes OUTSIDE the active transaction (drops the
 * session → standalone write). These tests pin both halves of the contract:
 * the write succeeds inside a txn context, and — because it committed
 * standalone — it is NOT rolled back if the surrounding txn aborts (the
 * accepted atomicity trade-off; the submitted doc is the source of truth).
 */
let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("Ledger", "app"); // regular collection
  await db.ensureCollection("StockMovement", "app", {
    timeseries: { time_field: "posted_at", meta_field: "warehouse" },
  });
}, 60_000);

afterAll(async () => {
  await db?.disconnect();
  await replSet?.stop();
});

describe("MongoDBService — time-series writes vs. multi-document transactions", () => {
  it("tracks which ensured collections are time-series", () => {
    expect(db.isTimeSeries("StockMovement", "app")).toBe(true);
    expect(db.isTimeSeries("Ledger", "app")).toBe(false);
  });

  it("inserts into a time-series collection from inside a transaction (session dropped, no code 263)", async () => {
    await db.withTransaction(async (session) => {
      await db.insertOne("Ledger", { _id: "L-1", note: "regular in-txn write" }, "app", session);
      await db.insertOne(
        "StockMovement",
        { posted_at: new Date(), warehouse: "WH-1", quantity: 5 },
        "app",
        session,
      );
    });
    const movements = await db.find("StockMovement", {}, "app");
    expect(movements.length).toBe(1);
    // The regular collection write stayed transactional and committed too.
    expect(await db.findOne("Ledger", "L-1", "app")).not.toBeNull();
  });

  it("time-series write survives an aborted transaction (standalone write, documented trade-off)", async () => {
    const before = (await db.find("StockMovement", {}, "app")).length;
    await expect(
      db.withTransaction(async (session) => {
        await db.insertOne(
          "StockMovement",
          { posted_at: new Date(), warehouse: "WH-2", quantity: 9 },
          "app",
          session,
        );
        // A regular write in the same txn WILL roll back.
        await db.insertOne("Ledger", { _id: "L-2", note: "rolled back" }, "app", session);
        throw new Error("force abort");
      }),
    ).rejects.toThrow("force abort");
    // The time-series row committed immediately outside the txn → still present.
    expect((await db.find("StockMovement", {}, "app")).length).toBe(before + 1);
    // The regular row was rolled back with the txn.
    expect(await db.findOne("Ledger", "L-2", "app")).toBeNull();
  });
});
