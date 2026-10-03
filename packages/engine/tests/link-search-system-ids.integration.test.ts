import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
import { ObjectId } from "mongodb";
import type { EntityDefinition } from "@digitaplatform/shared";
import { env } from "../src/core/config/env.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { LinkSearchService } from "../src/core/link/link-search-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// A portal role's row names `fields` without the title, so the picker shows the id instead, and
// matches and sorts on it. `system` naming stores the id as a native ObjectId, `user_set` as a string.
function tenderEntity(name: string, strategy: "system" | "user_set"): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app",
    naming: { strategy },
    title_field: "title",
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
      { fieldname: "code", fieldtype: "Data", label: "Code", idx: 2 },
      { fieldname: "lots", fieldtype: "Table", label: "Lots", idx: 3, child_fields: [{ fieldname: "label", fieldtype: "Data", label: "Label" }] },
    ],
    permissions: [{ role: "Portal", level: 0, select: 1, read: 1, fields: ["code", "lots"] }],
  } as unknown as EntityDefinition;
}

const entities: Record<string, EntityDefinition> = {
  tender: tenderEntity("tender", "system"),
  bid: tenderEntity("bid", "user_set"),
};
const registry = {
  has: (n: string) => n in entities,
  get: (n: string) => {
    const e = entities[n];
    if (!e) throw new Error(`unknown entity ${n}`);
    return e;
  },
} as never;

const portalUser: UserContext = { _id: "u1", email: "portal@test", roles: ["Portal"] };

// The hidden titles run against the ids, and the rows are stored in neither order, so a result
// ranked by the title or left unsorted shows. The third row matches no search and must not answer.
const tenderIds = ["65a000000000000000000001", "65a000000000000000000002", "77b000000000000000000003"] as const;
const bidIds = ["BID-1", "BID-2", "ASK-3"] as const;
const titles = ["Zeta", "Alpha", "Beta"] as const;
const storedOrder = [1, 2, 0] as const;

let replSet: ReplicaFixture;
let db: MongoDBService;
let svc: LinkSearchService;

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  for (const i of storedOrder) {
    const lots = [{ _row_id: `r${i + 1}`, label: `Lot ${i + 1}` }];
    await db.insertOne("tender", { _id: new ObjectId(tenderIds[i]), title: titles[i], code: `C-${i + 1}`, lots }, "app");
    await db.insertOne("bid", { _id: bidIds[i], title: titles[i], code: `C-${i + 1}`, lots }, "app");
  }
  svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("Link search matches the typed text on the id it shows where the title is hidden", () => {
  it("matches and sorts the ObjectId of a system-named row by the id as shown", async () => {
    expect(await svc.search("tender", "65a0", portalUser)).toEqual([
      { _id: tenderIds[0], display: tenderIds[0] },
      { _id: tenderIds[1], display: tenderIds[1] },
    ]);
  });

  it("matches and sorts the parents of sub-rows of a system-named row by the id as shown", async () => {
    expect(await svc.search("tender", "65a0", portalUser, undefined, 20, "lots")).toEqual([
      { _id: `${tenderIds[0]}::r1`, display: "Lot 1", subtitle: tenderIds[0] },
      { _id: `${tenderIds[1]}::r2`, display: "Lot 2", subtitle: tenderIds[1] },
    ]);
  });

  it("matches and sorts a string id as before", async () => {
    expect(await svc.search("bid", "bid", portalUser)).toEqual([
      { _id: "BID-1", display: "BID-1" },
      { _id: "BID-2", display: "BID-2" },
    ]);
  });

  it("matches and sorts the parents of sub-rows by a string id", async () => {
    expect(await svc.search("bid", "bid", portalUser, undefined, 20, "lots")).toEqual([
      { _id: "BID-1::r1", display: "Lot 1", subtitle: "BID-1" },
      { _id: "BID-2::r2", display: "Lot 2", subtitle: "BID-2" },
    ]);
  });
});
