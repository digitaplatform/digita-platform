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
import {
  MongoDBService,
  MalformedFilterError,
  type FilterEntry,
} from "../src/core/database/mongodb-service.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

const COLL = "FilterTest";
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
  await db.insertMany(
    COLL,
    [
      { _id: "a", group: "x", n: 1, active: true },
      { _id: "b", group: "x", n: 2, active: false },
      { _id: "c", group: "y", n: 3, active: true },
      { _id: "d", group: "y", n: 4, active: true },
    ],
    TARGET,
  );
});

describe("MongoDBService filter formats", () => {
  it("Form 1: tuple-style top-level filter (=) returns matching rows", async () => {
    const r = await db.find(COLL, { filters: [["group", "=", "x"]] }, TARGET);
    expect(r.map((d) => d._id).sort()).toEqual(["a", "b"]);
  });

  it("Form 1: tuple-style with operator !=", async () => {
    const r = await db.find(COLL, { filters: [["group", "!=", "x"]] }, TARGET);
    expect(r.map((d) => d._id).sort()).toEqual(["c", "d"]);
  });

  it("Form 1: tuple-style with operator >=", async () => {
    const r = await db.find(COLL, { filters: [["n", ">=", 3]] }, TARGET);
    expect(r.map((d) => d._id).sort()).toEqual(["c", "d"]);
  });

  it("Form 1: tuple-style with operator in", async () => {
    const r = await db.find(COLL, { filters: [["_id", "in", ["a", "c"]]] }, TARGET);
    expect(r.map((d) => d._id).sort()).toEqual(["a", "c"]);
  });

  it("Form 2: object-style equals", async () => {
    const r = await db.find(COLL, { filters: [{ group: "y" }] }, TARGET);
    expect(r.map((d) => d._id).sort()).toEqual(["c", "d"]);
  });

  it("Form 2: object-style with native Mongo operator $ne", async () => {
    const r = await db.find(COLL, { filters: [{ active: { $ne: true } }] }, TARGET);
    expect(r.map((d) => d._id)).toEqual(["b"]);
  });

  it("Form 2: object-style multi-field AND", async () => {
    const r = await db.find(
      COLL,
      { filters: [{ group: "y", active: true }] },
      TARGET,
    );
    expect(r.map((d) => d._id).sort()).toEqual(["c", "d"]);
  });

  it("Form 3 (legacy): tuple-as-value with arbitrary key", async () => {
    const r = await db.find(
      COLL,
      { filters: [{ _whatever: ["n", ">", 2] }] },
      TARGET,
    );
    expect(r.map((d) => d._id).sort()).toEqual(["c", "d"]);
  });

  it("mixed forms in one filters array", async () => {
    const r = await db.find(
      COLL,
      {
        filters: [
          ["group", "=", "x"],
          { active: true },
        ],
      },
      TARGET,
    );
    expect(r.map((d) => d._id)).toEqual(["a"]);
  });

  it("count() supports the same formats", async () => {
    const c = await db.count(COLL, [["active", "=", true]], TARGET);
    expect(c).toBe(3);
  });

  it("empty filter array returns all rows", async () => {
    const r = await db.find(COLL, { filters: [] }, TARGET);
    expect(r.length).toBe(4);
  });

  it("rejects malformed tuple — wrong arity", async () => {
    await expect(
      db.find(COLL, { filters: [["group", "="] as unknown as FilterEntry] }, TARGET),
    ).rejects.toThrow(MalformedFilterError);
  });

  it("rejects malformed tuple — non-string field", async () => {
    await expect(
      db.find(COLL, { filters: [[123, "=", "x"] as unknown as FilterEntry] }, TARGET),
    ).rejects.toThrow(MalformedFilterError);
  });

  it("rejects primitive in filters array", async () => {
    await expect(
      db.find(COLL, { filters: ["nope" as unknown as FilterEntry] }, TARGET),
    ).rejects.toThrow(MalformedFilterError);
  });

  it("rejects null in filters array", async () => {
    await expect(
      db.find(COLL, { filters: [null as unknown as FilterEntry] }, TARGET),
    ).rejects.toThrow(MalformedFilterError);
  });
});
