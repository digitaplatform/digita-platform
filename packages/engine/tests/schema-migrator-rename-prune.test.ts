import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
    PRUNE_ORPHAN_INDEXES: false,
    PRUNE_ORPHAN_COLLECTIONS: false,
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { SchemaMigrator } from "../src/core/database/schema-migrator.js";
import { env } from "../src/core/config/env.js";
import type { EntityDefinition } from "@digitaplatform/shared";

// Minimal MongoDBService stand-in. Tracks listCollections per database
// and drop calls so the tests can assert behaviour without a real Mongo.
function makeFakeDb(initial: Record<string, string[]>) {
  const dbs: Record<string, string[]> = JSON.parse(JSON.stringify(initial));
  const calls: { drops: Array<[string, string]> } = { drops: [] };
  return {
    calls,
    listCollections: vi.fn(async (target: string) => [...(dbs[target] ?? [])]),
    ensureCollection: vi.fn(async (name: string, target: string) => {
      const list = (dbs[target] ??= []);
      if (!list.includes(name)) list.push(name);
    }),
    dropCollection: vi.fn(async (name: string, target: string) => {
      const list = dbs[target];
      if (!list || !list.includes(name)) return false;
      list.splice(list.indexOf(name), 1);
      calls.drops.push([name, target]);
      return true;
    }),
    findOne: vi.fn(async () => ({ _id: "x", naming_seq: 0 })),
    insertOne: vi.fn(async () => undefined),
    collection: vi.fn(() => ({
      indexes: vi.fn(async () => [{ name: "_id_" }]),
      dropIndex: vi.fn(),
      createIndex: vi.fn(),
    })),
  };
}

const baseEntity = (override: Partial<EntityDefinition>): EntityDefinition => ({
  name: "Customer",
  module: "erp_master",
  database: "erp_master" as never,
  naming: { strategy: "user_set" },
  fields: [],
  permissions: [],
  ...override,
}) as EntityDefinition;

beforeEach(() => {
  (env as unknown as { PRUNE_ORPHAN_COLLECTIONS: boolean }).PRUNE_ORPHAN_COLLECTIONS = false;
});

describe("schema-migrator: orphan-collection sweep", () => {
  it("reports orphan collections without dropping when flag is off", async () => {
    const db = makeFakeDb({ erp_master: ["Customer", "DeadEntity", "_sequences"] });
    const migrator = new SchemaMigrator(db as never);
    const e = baseEntity({});
    const reports = await migrator.sweepOrphanCollections([e]);
    expect(reports).toEqual([
      { database: "erp_master", collection: "DeadEntity", dropped: false },
    ]);
    expect(db.calls.drops).toEqual([]);
  });

  it("drops orphan collections when PRUNE_ORPHAN_COLLECTIONS=true", async () => {
    (env as unknown as { PRUNE_ORPHAN_COLLECTIONS: boolean }).PRUNE_ORPHAN_COLLECTIONS = true;
    const db = makeFakeDb({ erp_master: ["Customer", "DeadEntity"] });
    const migrator = new SchemaMigrator(db as never);
    const e = baseEntity({});
    const reports = await migrator.sweepOrphanCollections([e]);
    expect(reports[0]?.dropped).toBe(true);
    expect(db.calls.drops).toEqual([["DeadEntity", "erp_master"]]);
  });

  it("ignores _internal and system.* collections", async () => {
    (env as unknown as { PRUNE_ORPHAN_COLLECTIONS: boolean }).PRUNE_ORPHAN_COLLECTIONS = true;
    const db = makeFakeDb({
      erp_master: ["Customer", "_sequences", "system.profile", "_token_cache"],
    });
    const migrator = new SchemaMigrator(db as never);
    const e = baseEntity({});
    const reports = await migrator.sweepOrphanCollections([e]);
    expect(reports).toEqual([]);
    expect(db.calls.drops).toEqual([]);
  });

  it("groups by database — only sweeps databases that hold registered entities", async () => {
    (env as unknown as { PRUNE_ORPHAN_COLLECTIONS: boolean }).PRUNE_ORPHAN_COLLECTIONS = true;
    const db = makeFakeDb({
      erp_master: ["Customer", "DeadInMaster"],
      erp_sales: ["DeadInSales"],
    });
    const migrator = new SchemaMigrator(db as never);
    const e = baseEntity({});
    // Only an entity in erp_master is registered.
    const reports = await migrator.sweepOrphanCollections([e]);
    // erp_sales is not in expectedByDb so the migrator never asks; only
    // the master orphan shows up.
    expect(reports).toEqual([
      { database: "erp_master", collection: "DeadInMaster", dropped: true },
    ]);
  });

  it("never sweeps the identity database — digita-auth owns it (ADR-12 P3)", async () => {
    (env as unknown as { PRUNE_ORPHAN_COLLECTIONS: boolean }).PRUNE_ORPHAN_COLLECTIONS = true;
    // Engine declares DocShare in identity; User/Session/LoginAudit are
    // digita-auth's and undeclared — they must NOT be reported or dropped.
    const db = makeFakeDb({
      identity: ["DocShare", "User", "Session", "LoginAudit"],
    });
    const migrator = new SchemaMigrator(db as never);
    const e = baseEntity({ name: "DocShare", database: "identity" as never });
    const reports = await migrator.sweepOrphanCollections([e]);
    expect(reports).toEqual([]);
    expect(db.calls.drops).toEqual([]);
  });
});
