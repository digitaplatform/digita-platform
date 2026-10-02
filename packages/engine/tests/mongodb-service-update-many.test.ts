import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return {
    env: {
      MONGODB_URI: "",
      MONGODB_MIN_POOL: 1,
      MONGODB_MAX_POOL: 5,
      MONGODB_TIMEOUT_MS: 30000,
      MONGODB_RETRY_WRITES: true,
      MONGODB_IDENTITY_DB: "test_users",
      MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
      MONGODB_CORE_DB: "test_admin",
      MONGODB_APP_DB_PREFIX: "test",
    },
  };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));


import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { env } from "../src/core/config/env.js";

// updateMany changes every row its filter matches, in a session when it is given one, and takes
// an aggregation pipeline that computes a row's new value from its own fields.
let replSet: MongoMemoryReplSet;
let db: MongoDBService;
const COLL = "UpdateManyTest";
const TARGET = "admin";

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection(COLL, TARGET);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  await db.deleteMany(COLL, {}, TARGET);
  await db.insertMany(COLL, [
    { _id: "a", path: ["r"], n: 1 },
    { _id: "b", path: ["r", "a"], n: 2 },
    { _id: "c", path: ["s"], n: 3 },
  ], TARGET);
});

const rows = async () => (await db.find(COLL, { order_by: "_id asc" }, TARGET)).map((r) => [r["_id"], r["path"], r["n"]]);

describe("MongoDBService.updateMany", () => {
  it("applies an update document to every row the filter matches, and to no other", async () => {
    expect(await db.updateMany(COLL, { path: "r" }, { $inc: { n: 10 } }, TARGET)).toBe(2);
    expect(await rows()).toEqual([["a", ["r"], 11], ["b", ["r", "a"], 12], ["c", ["s"], 3]]);
  });

  it("computes each row's value from its own fields through a pipeline", async () => {
    await db.updateMany(COLL, { path: "r" }, [{ $set: { path: { $concatArrays: [["root"], "$path"] }, n: { $size: "$path" } } }], TARGET);
    expect(await rows()).toEqual([["a", ["root", "r"], 1], ["b", ["root", "r", "a"], 2], ["c", ["s"], 3]]);
  });

  it("writes in the session's transaction, so an aborted one leaves every row as it was", async () => {
    await expect(
      db.withTransaction(async (session) => {
        await db.updateMany(COLL, {}, { $set: { n: 0 } }, TARGET, session);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await rows()).map((r) => r[2])).toEqual([1, 2, 3]);
  });
});
