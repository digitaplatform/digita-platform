import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AggregateSection } from "@digitaplatform/shared";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { runAggregateSection } from "../src/core/view/section-runners/aggregate-section.js";

// A $lookup without a sub-pipeline joins the foreign rows whole, in their stored
// shape. Read after the fact under the `as` key alone, the value survived every
// stage that copies or moves the joined rows (#85, reviewer's probes on MongoDB).
const entities: Record<string, unknown> = {
  Vault: {
    name: "Vault", database: "app", permissions: [],
    fields: [{ fieldname: "title", fieldtype: "Data" }, { fieldname: "secret", fieldtype: "Password" }],
  },
  Note: {
    name: "Note", database: "app", permissions: [],
    fields: [{ fieldname: "title", fieldtype: "Data" }, { fieldname: "vault_id", fieldtype: "Link", target: "Vault" }],
  },
};
const registry = { has: (n: string) => n in entities, get: (n: string) => entities[n] } as never;
const user = { _id: "u1", email: "admin@example.com", roles: ["Administrator"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };
const lookup = { $lookup: { from: "Vault", localField: "vault_id", foreignField: "_id", as: "vault" } };

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.insertOne("Vault", { _id: "V-1", title: "Mail server", secret: "hunter2-first" }, "app");
  await db.insertOne("Note", { _id: "N-1", title: "Note", vault_id: "V-1" }, "app");
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

const run = (pipeline: unknown[]) =>
  runAggregateSection({ key: "k", kind: "aggregate", entity: "Note", pipeline } as AggregateSection, rctx, user, {
    db,
    registry,
    tenantTimeZone: () => "UTC",
    permissionChecker: {
      check: vi.fn().mockResolvedValue(undefined),
      getReadableFieldsOnEveryRow: vi.fn(() => null),
      hasConditionalRowRead: vi.fn(() => false), // #86: no read condition on this Administrator
    },
  } as never);

describe("a $lookup without a sub-pipeline from an entity with a Password field", () => {
  it.each([
    ["$addFields copying the joined rows", [lookup, { $addFields: { copy: "$vault" } }]],
    ["$project moving the joined rows", [lookup, { $project: { moved: "$vault" } }]],
    ["$unwind and $group pushing them", [lookup, { $unwind: "$vault" }, { $group: { _id: null, all: { $push: "$vault" } } }]],
    ["a $facet branch", [{ $facet: { a: [lookup] } }]],
    ["$project of the field under the joined path", [lookup, { $project: { pw: "$vault.secret" } }]],
  ])("never carries the value through %s", async (_name, pipeline) => {
    const rows = await run(pipeline);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("hunter2");
  });

  it("still joins the rows, without the value", async () => {
    const rows = await run([lookup]);
    const vault = (rows[0]!["vault"] as Record<string, unknown>[])[0]!;
    expect(vault["title"]).toBe("Mail server");
    expect(vault["secret"]).toBeUndefined();
  });
});
