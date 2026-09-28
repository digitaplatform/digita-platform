import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// The seed loader's two modes: insert (skip what exists) and upsert (replace what
// changed, keep what the seed does not carry, report it). The website engine seeds
// its site in upsert mode so a page changed in the catalog reaches the live site.
const { logSpy } = vi.hoisted(() => ({
  logSpy: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => logSpy,
  getRootLogger: () => logSpy,
}));
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l",
    MONGODB_AUDITS_DB: "a", MONGODB_CORE_DB: "c", MONGODB_APP_DB_PREFIX: "test",
  },
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";

const page: EntityDefinition = {
  name: "WebPage",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "published"] },
    {
      fieldname: "blocks",
      fieldtype: "Table",
      label: "Blocks",
      child_fields: [
        { fieldname: "type", fieldtype: "Data", label: "Type" },
        { fieldname: "props", fieldtype: "JSON", label: "Props" },
      ],
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

const seedHome = { _id: "site::en::", title: "New home", status: "published", blocks: [{ type: "hero", props: { heading: "Hi" } }] };
const seedConcept = { _id: "site::en::concept", title: "The concept", status: "published", blocks: [] };

/** A stored home page as this loader wrote it on an earlier boot, with a child row id. */
const storedHome = {
  _id: "site::en::",
  doctype: "WebPage",
  docstatus: 0,
  title: "Old home",
  status: "published",
  blocks: [{ type: "hero", props: { heading: "Hi" }, _row_id: "row0000000000001" }],
  owner: "admin@example.com",
  creation: new Date("2026-01-01T00:00:00Z"),
  modified_by: "admin@example.com",
  modified: new Date("2026-01-02T00:00:00Z"),
};

/** A database that holds the old home page and one page the seed does not carry. */
function mockDb(initial: Record<string, unknown>[]) {
  const stored = new Map<string, Record<string, unknown>>(initial.map((doc) => [String(doc._id), doc]));
  const db = {
    findOne: vi.fn(async (_coll: string, id: string) => stored.get(id) ?? null),
    find: vi.fn(async () => [...stored.values()].map((doc) => ({ _id: doc._id }))),
    insertMany: vi.fn(async (_coll: string, docs: Record<string, unknown>[]) => {
      for (const doc of docs) stored.set(String(doc._id), doc);
    }),
    // replaceOne keeps the stored _id; the written document carries none.
    upsertOne: vi.fn(async (_coll: string, id: string, data: Record<string, unknown>) => {
      expect(data).not.toHaveProperty("_id");
      stored.set(id, { ...data, _id: stored.get(id)?._id ?? id });
    }),
    updateOne: vi.fn(async () => {}),
    deleteMany: vi.fn(async () => 0),
    getNextSequence: vi.fn(async () => 1),
    setSequenceValue: vi.fn(async () => {}),
    setSequenceFloor: vi.fn(async () => {}),
  } as unknown as MongoDBService;
  return { db, stored };
}

function registry() {
  const reg = new EntityRegistry();
  reg.register(page);
  return reg;
}

let dir: string;
async function seedFile(rows: unknown[]) {
  await writeFile(join(dir, "WebPage.seed.json"), JSON.stringify(rows));
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seed-upsert-"));
  await seedFile([seedHome, seedConcept]);
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("seedAppData modes", () => {
  it("insert mode (the default) skips an existing row and inserts a new one", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedAppData(db, registry(), {} as NamingService, [dir]);
    // The planted defect this test guards: a default call that replaces existing rows.
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("site::en::")?.title).toBe("Old home");
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it("upsert mode replaces a changed row, keeps creation, owner and the child row ids", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedAppData(db, registry(), {} as NamingService, [dir], { mode: "upsert" });
    expect(db.upsertOne).toHaveBeenCalledTimes(1);
    const home = stored.get("site::en::")!;
    expect(home.title).toBe("New home");
    expect(home.owner).toBe("admin@example.com");
    expect(home.creation).toEqual(storedHome.creation);
    expect(home.modified_by).toBe("system");
    expect(home.modified).not.toEqual(storedHome.modified);
    expect((home.blocks as Array<Record<string, unknown>>)[0]?._row_id).toBe("row0000000000001");
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
  });

  it("upsert mode writes nothing for an unchanged seed, so modified stays as it was", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedAppData(db, registry(), {} as NamingService, [dir], { mode: "upsert" });
    const afterFirst = { ...stored.get("site::en::")! };
    vi.clearAllMocks();
    await seedAppData(db, registry(), {} as NamingService, [dir], { mode: "upsert" });
    // The planted defect: a loader that rewrites every row on every boot.
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(db.insertMany).not.toHaveBeenCalled();
    expect(stored.get("site::en::")?.modified).toEqual(afterFirst.modified);
    expect((stored.get("site::en::")!.blocks as Array<Record<string, unknown>>)[0]?._row_id).toBe("row0000000000001");
  });

  it("upsert mode never deletes a row the seed does not carry, and reports it", async () => {
    const dropped = { ...storedHome, _id: "site::en::dropped", title: "Dropped" };
    const { db, stored } = mockDb([storedHome, dropped]);
    await seedAppData(db, registry(), {} as NamingService, [dir], { mode: "upsert" });
    expect(stored.get("site::en::dropped")?.title).toBe("Dropped");
    expect(db.deleteMany).not.toHaveBeenCalled();
    const warned = logSpy.warn.mock.calls.find(([, msg]) => String(msg).includes("does not carry"));
    expect(warned?.[0]).toMatchObject({ entity: "WebPage", unseeded: 1, ids: ["site::en::dropped"] });
  });

  it("upsert mode refuses an invalid docstatus exactly as insert mode does", async () => {
    await seedFile([{ ...seedHome, docstatus: 5 }]);
    const { db } = mockDb([storedHome]);
    await expect(seedAppData(db, registry(), {} as NamingService, [dir], { mode: "upsert" })).rejects.toThrow(
      "invalid docstatus",
    );
    expect(db.upsertOne).not.toHaveBeenCalled();
    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).rejects.toThrow("invalid docstatus");
  });
});
