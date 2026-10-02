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
import { ObjectId } from "mongodb";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { runAggregateSection } from "../src/core/view/section-runners/aggregate-section.js";

// A `system`-named entity stores its _id as an ObjectId, and a Link to it holds the id as text. A
// view's $lookup between the two joins the rows from either side, as a list filter on _id matches.
const entities: Record<string, unknown> = {
  Event: {
    name: "Event", database: "app", permissions: [], naming: { strategy: "system" },
    fields: [{ fieldname: "title", fieldtype: "Data" }],
  },
  Registration: {
    name: "Registration", database: "app", permissions: [],
    fields: [
      { fieldname: "guest", fieldtype: "Data" },
      { fieldname: "event", fieldtype: "Link", target: "Event" },
      { fieldname: "also_events", fieldtype: "JSON" },
    ],
  },
};
const registry = { has: (n: string) => n in entities, get: (n: string) => entities[n] } as never;
const user = { _id: "u1", email: "admin@example.com", roles: ["Administrator"] } as never;
const rctx = { root: null, user, params: {}, now: new Date(), warnings: [] };
const EVENT_ID = new ObjectId();

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.insertOne("Event", { _id: EVENT_ID as never, title: "Spring fair" }, "app");
  await db.insertOne("Registration", { _id: "R-1", guest: "Ada", event: EVENT_ID.toHexString(), also_events: ["no-such-event", EVENT_ID.toHexString()] }, "app");
  await db.insertOne("Registration", { _id: "R-2", guest: "Bob", event: EVENT_ID.toHexString() }, "app");
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

const run = (entity: string, pipeline: unknown[]) =>
  runAggregateSection({ key: "k", kind: "aggregate", entity, pipeline } as never, rctx as never, user, {
    db,
    registry,
    permissionChecker: {
      check: async () => undefined,
      getReadableFieldsOnEveryRow: () => null,
      hasConditionalRowRead: () => false,
    },
    tenantTimeZone: () => "UTC",
  } as never);

describe("a view $lookup between a system _id and a Link to it", () => {
  it("joins the Links of an event from the event's ObjectId _id", async () => {
    const rows = await run("Event", [
      { $lookup: { from: "Registration", localField: "_id", foreignField: "event", as: "registrations" } },
    ]);
    expect((rows[0]!["registrations"] as Array<{ guest: string }>).map((r) => r.guest).sort()).toEqual(["Ada", "Bob"]);
    expect("__join_key" in rows[0]!).toBe(false);
  });

  it("joins the event from a registration's Link text", async () => {
    const rows = await run("Registration", [
      { $sort: { _id: 1 } },
      { $lookup: { from: "Event", localField: "event", foreignField: "_id", as: "event_doc" } },
    ]);
    expect((rows[0]!["event_doc"] as Array<{ title: string }>).map((e) => e.title)).toEqual(["Spring fair"]);
  });

  it("joins each element of a list-valued local field", async () => {
    const rows = await run("Registration", [
      { $match: { _id: "R-1" } },
      { $lookup: { from: "Event", localField: "also_events", foreignField: "_id", as: "events" } },
    ]);
    expect((rows[0]!["events"] as Array<{ title: string }>).map((e) => e.title)).toEqual(["Spring fair"]);
  });

  it("joins inside the sub-pipeline of another $lookup", async () => {
    const nested = await run("Event", [
      { $lookup: { from: "Registration", as: "regs", pipeline: [{ $lookup: { from: "Event", localField: "event", foreignField: "_id", as: "back" } }] } },
    ]);
    const regs = nested[0]!["regs"] as Array<{ back: Array<{ title: string }> }>;
    expect(regs.every((r) => r.back.map((e) => e.title).join() === "Spring fair")).toBe(true);
  });
});
