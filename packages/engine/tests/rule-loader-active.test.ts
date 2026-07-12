// Regression test for the silent filter-format bug in `loadActiveRules`.
// Pre-fix, the function passed `{field, op, value}` filter shape (which is
// not a supported format in MongoDBService.buildMongoFilter) — it returned
// an empty array no matter how many rules existed, so the entire
// rule-engine never fired in production. This test makes sure the
// (entity, event, enabled) filter actually selects matching rows.
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
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
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { loadActiveRules, clearRuleCache } from "../src/core/rules/rule-loader.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("Rule", "core");
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  await db.deleteMany("Rule", {}, "core");
  clearRuleCache();
});

describe("loadActiveRules", () => {
  it("returns rules whose entity + event + enabled match", async () => {
    await db.insertMany(
      "Rule",
      [
        { _id: "r1", entity: "Invoice", event: "on_submit", enabled: true,  priority: 10 },
        { _id: "r2", entity: "Invoice", event: "on_submit", enabled: true,  priority: 20 },
        { _id: "r3", entity: "Invoice", event: "on_submit", enabled: false, priority: 5  },
        { _id: "r4", entity: "Invoice", event: "before_submit", enabled: true, priority: 5 },
        { _id: "r5", entity: "Order",   event: "on_submit", enabled: true,  priority: 5 },
      ],
      "core",
    );

    const rules = await loadActiveRules(db, "Invoice", "on_submit");
    expect(rules.map((r: { _id?: string }) => r._id)).toEqual(["r1", "r2"]);
  });

  it("orders rules by priority ascending", async () => {
    await db.insertMany(
      "Rule",
      [
        { _id: "high", entity: "X", event: "validate", enabled: true, priority: 100 },
        { _id: "low",  entity: "X", event: "validate", enabled: true, priority: 1   },
        { _id: "mid",  entity: "X", event: "validate", enabled: true, priority: 50  },
      ],
      "core",
    );

    const rules = await loadActiveRules(db, "X", "validate");
    expect(rules.map((r: { _id?: string }) => r._id)).toEqual(["low", "mid", "high"]);
  });

  it("returns empty array when no rules match", async () => {
    const rules = await loadActiveRules(db, "Nonexistent", "on_submit");
    expect(rules).toEqual([]);
  });

  it("filters out disabled rules", async () => {
    await db.insertOne(
      "Rule",
      { _id: "off", entity: "X", event: "on_submit", enabled: false, priority: 5 },
      "core",
    );
    const rules = await loadActiveRules(db, "X", "on_submit");
    expect(rules).toEqual([]);
  });
});
