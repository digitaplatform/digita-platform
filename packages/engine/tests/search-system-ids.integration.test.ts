import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { buildMongoFilter } from "../src/core/database/filter-builder.js";
import { GlobalSearchService } from "../src/core/search/global-search-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// A list search and the global search match the typed text against `_id` as the result shows it.
// `system` naming stores the id as an ObjectId, which a `$regex` never matches.
function ticketEntity(name: string, strategy: "system" | "user_set"): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app",
    naming: { strategy },
    title_field: "title",
    in_global_search: true,
    search_fields: ["_id", "title"],
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 }],
    permissions: [{ role: "Agent", level: 0, select: 1, read: 1 }],
  } as unknown as EntityDefinition;
}

const entities: Record<string, EntityDefinition> = { ticket: ticketEntity("ticket", "system"), memo: ticketEntity("memo", "user_set") };
const registry = {
  has: (n: string) => n in entities,
  get: (n: string) => entities[n]!,
  getAll: () => Object.values(entities),
} as never;
const agent: UserContext = { _id: "u1", email: "agent@test", roles: ["Agent"] };
const TICKET_ID = new ObjectId("65a0000000000000000000c7");

let replSet: MongoMemoryReplSet;
let db: MongoDBService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.insertOne("ticket", { _id: TICKET_ID as never, title: "Printer jam" }, "app");
  await db.insertOne("ticket", { _id: new ObjectId("77b000000000000000000001") as never, title: "Other" }, "app");
  await db.insertOne("memo", { _id: "MEMO-0c7", title: "Note" }, "app");
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

const listIds = async (entity: string, search: string) =>
  (await db.find(entity, { filters: [buildMongoFilter({ search }, ["_id", "title"])] }, "app")).map((r) => String((r as { _id: unknown })._id));

describe("a search on _id", () => {
  it("finds a system-named row in a list by a part of its id", async () => {
    expect(await listIds("ticket", "0c7")).toEqual([TICKET_ID.toHexString()]);
  });

  it("keeps finding a string id in a list", async () => {
    expect(await listIds("memo", "0c7")).toEqual(["MEMO-0c7"]);
  });

  it("finds a system-named row in the global search by a part of its id", async () => {
    const svc = new GlobalSearchService(registry, db, new PermissionChecker(registry));
    const found = await svc.search("0c7", agent);
    expect(found.filter((r) => r.entity === "ticket").map((r) => String(r._id))).toEqual([TICKET_ID.toHexString()]);
    expect(found.filter((r) => r.entity === "memo").map((r) => String(r._id))).toEqual(["MEMO-0c7"]);
  });
});
