import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// A seed file that grows after the first boot: a new row links, by business key, a row
// the first boot stored. The link must name the stored row, whatever the target's naming.
vi.mock("../src/core/logging/logger.js", () => {
  const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  return { createLogger: () => log, getRootLogger: () => log };
});
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l",
    MONGODB_AUDITS_DB: "a", MONGODB_CORE_DB: "c", MONGODB_APP_DB_PREFIX: "test",
  },
}));

import type { EntityDefinition, NamingStrategy } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";

const STORED_AUTHOR = { _id: "stored-author-id", name: "Ursula" };

function registry(strategy: NamingStrategy): EntityRegistry {
  const reg = new EntityRegistry();
  reg.register({
    name: "Author", module: "test", database: "app", business_key: "name",
    naming: { strategy, prefix: "AU-", ...(strategy === "expression" ? { expression: "AU-{name}" } : {}) },
    fields: [{ fieldname: "name", fieldtype: "Data", label: "Name" }],
    permissions: [],
  } as unknown as EntityDefinition);
  reg.register({
    name: "Book", module: "test", database: "app", business_key: "title",
    naming: { strategy: "system" },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "author", fieldtype: "Link", target: "Author", label: "Author" },
    ],
    permissions: [],
  } as unknown as EntityDefinition);
  return reg;
}

/** A db that holds the author the first boot stored and records every insert. */
function mockDb() {
  const inserted: Record<string, Array<Record<string, unknown>>> = {};
  const db = {
    find: vi.fn(async (coll: string) => (coll === "Author" ? [STORED_AUTHOR] : [])),
    findOne: vi.fn(async (coll: string, id: string) =>
      coll === "Author" && id === STORED_AUTHOR._id ? STORED_AUTHOR : null,
    ),
    insertMany: vi.fn(async (coll: string, docs: Array<Record<string, unknown>>) => {
      (inserted[coll] ??= []).push(...docs);
    }),
    getNextSequence: vi.fn(async () => 7),
    setSequenceValue: vi.fn(async () => {}),
    setSequenceFloor: vi.fn(async () => {}),
    deleteMany: vi.fn(async () => 0),
  } as unknown as MongoDBService;
  return { db, inserted };
}

describe("a seed pass links a new row to the stored row of its business key (#163)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "digita-seed-stored-links-"));
    await writeFile(join(dir, "Author.seed.json"), JSON.stringify([{ name: "Ursula" }]), "utf-8");
    await writeFile(
      join(dir, "Book.seed.json"),
      JSON.stringify([{ title: "Earthsea", author: "Ursula" }]),
      "utf-8",
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  for (const strategy of ["system", "auto_increment", "expression"] as const) {
    it(`resolves the Link to the stored _id and writes no second Author (${strategy} naming)`, async () => {
      const { db, inserted } = mockDb();
      const namingService = { generateId: vi.fn(async () => "AU-Ursula-minted") } as unknown as NamingService;

      await seedAppData(db, registry(strategy), namingService, [dir]);

      expect(inserted["Book"]?.map((b) => b["author"])).toEqual([STORED_AUTHOR._id]);
      expect(inserted["Author"]).toBeUndefined();
    });
  }

  it("never lends a seed row's own _id when a stored row holds its business key", async () => {
    // The insert of this row collides on the business key, so its _id is never stored.
    await writeFile(join(dir, "Author.seed.json"), JSON.stringify([{ _id: "AU-NEW", name: "Ursula" }]), "utf-8");
    const { db, inserted } = mockDb();

    await seedAppData(db, registry("system"), {} as NamingService, [dir]);

    expect(inserted["Book"]?.map((b) => b["author"])).toEqual([STORED_AUTHOR._id]);
  });
});
