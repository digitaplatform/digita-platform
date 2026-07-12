import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Capture the module logger so we can assert the guard diagnostics.
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

function entity(opts: Partial<EntityDefinition> & { name: string }): EntityDefinition {
  return {
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [],
    permissions: [],
    ...opts,
  } as EntityDefinition;
}

/** Records every insertMany so we can assert which seeds reached the DB write. */
function mockDb() {
  const inserted: Record<string, unknown[]> = {};
  const db = {
    findOne: vi.fn(async () => null), // nothing exists yet -> would insert
    insertMany: vi.fn(async (coll: string, docs: unknown[]) => {
      (inserted[coll] ??= []).push(...docs);
    }),
    getNextSequence: vi.fn(async () => 1),
    setSequenceValue: vi.fn(async () => {}),
    deleteMany: vi.fn(async () => 0),
  } as unknown as MongoDBService;
  return { db, inserted };
}

function registry() {
  const reg = new EntityRegistry();
  reg.register(entity({ name: "Role" }));
  reg.register(entity({ name: "Company", is_single: true }));
  reg.register(entity({ name: "Thing" })); // non-single, user_set
  reg.register(entity({ name: "Widget" })); // valid control
  return reg;
}

const errorCalls = () => logSpy.error.mock.calls as Array<[Record<string, unknown>, string]>;

describe("seedAppData guards", () => {
  let dir: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), "digita-seed-guards-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(files: Record<string, unknown>) {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), JSON.stringify(content), "utf-8");
    }
    const { db, inserted } = mockDb();
    await seedAppData(db, registry(), {} as NamingService, [dir]);
    return inserted;
  }

  it("skips a seed whose basename does not match an entity, with a case-insensitive hint", async () => {
    const inserted = await seed({ "role.seed.json": [{ _id: "admin", name: "Administrator" }] });
    expect(inserted["Role"]).toBeUndefined(); // never inserted
    const hit = errorCalls().find((c) => c[0]?.["entity"] === "role");
    expect(hit).toBeTruthy();
    expect(hit?.[0]["did_you_mean"]).toBe("Role"); // points at the correct casing
    expect(hit?.[1]).toMatch(/rename to Role\.seed\.json/);
  });

  it("skips an is_single seed that declares more than one row", async () => {
    const inserted = await seed({ "Company.seed.json": [{ _id: "A" }, { _id: "B" }] });
    expect(inserted["Company"]).toBeUndefined();
    const hit = errorCalls().find((c) => c[0]?.["entity"] === "Company");
    expect(hit?.[1]).toMatch(/exactly one row/);
  });

  it("skips a user_set seed row missing an explicit _id", async () => {
    const inserted = await seed({ "Thing.seed.json": [{ name: "no id here" }] });
    expect(inserted["Thing"]).toBeUndefined();
    const hit = errorCalls().find((c) => c[0]?.["entity"] === "Thing");
    expect(hit?.[1]).toMatch(/explicit _id/);
  });

  it("seeds a valid file (control) — guards do not block the happy path", async () => {
    const inserted = await seed({ "Widget.seed.json": [{ _id: "W1", name: "ok" }] });
    expect(inserted["Widget"]).toHaveLength(1);
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("a single is_single row + explicit _id passes both guards", async () => {
    const inserted = await seed({ "Company.seed.json": [{ _id: "MAIN", legal_name: "Acme" }] });
    expect(inserted["Company"]).toHaveLength(1);
  });

  it("tolerates a duplicate-key collision (E11000) on a non-_id unique index — does not throw", async () => {
    await writeFile(join(dir, "Widget.seed.json"), JSON.stringify([{ _id: "W1", code: "X" }]), "utf-8");
    const db = {
      findOne: vi.fn(async () => null), // _id not present -> would insert
      insertMany: vi.fn(async () => {
        // mimic an unordered bulk write where the unique `code` already exists
        throw { writeErrors: [{ code: 11000 }], result: { insertedCount: 0 } };
      }),
      getNextSequence: vi.fn(async () => 1),
      setSequenceValue: vi.fn(async () => {}),
    } as unknown as MongoDBService;
    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).resolves.toBeUndefined();
    expect(logSpy.warn).toHaveBeenCalled(); // skip path logged, not fatal
  });

  it("re-throws a non-duplicate insert error (real failure stays loud)", async () => {
    await writeFile(join(dir, "Widget.seed.json"), JSON.stringify([{ _id: "W1", code: "X" }]), "utf-8");
    const db = {
      findOne: vi.fn(async () => null),
      insertMany: vi.fn(async () => {
        throw new Error("connection lost");
      }),
      getNextSequence: vi.fn(async () => 1),
      setSequenceValue: vi.fn(async () => {}),
    } as unknown as MongoDBService;
    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).rejects.toThrow("connection lost");
  });

  it("advances the naming counter monotonically ($max) — a re-seed never rewinds a live counter", async () => {
    await writeFile(join(dir, "PreThing.seed.json"), JSON.stringify([{ _id: "PRE-00011", name: "x" }]), "utf-8");
    // A live counter already advanced to 50 by runtime inserts.
    const store: Record<string, number> = { naming_seq: 50 };
    const setValue = vi.fn(async (_n: string, f: string, v: number) => {
      store[f] = v; // mimics $set (unconditional)
    });
    const setFloor = vi.fn(async (_n: string, f: string, v: number) => {
      store[f] = Math.max(store[f] ?? 0, v); // mimics $max
    });
    const db = {
      findOne: vi.fn(async () => null),
      insertMany: vi.fn(async () => {}),
      getNextSequence: vi.fn(async () => 1),
      setSequenceValue: setValue,
      setSequenceFloor: setFloor,
      deleteMany: vi.fn(async () => 0),
    } as unknown as MongoDBService;
    const reg = new EntityRegistry();
    reg.register(entity({ name: "PreThing", naming: { strategy: "user_set", prefix: "PRE-" } }));

    await seedAppData(db, reg, {} as NamingService, [dir]);

    // Counter stays at 50 (not rewound to the seeded 11).
    expect(store.naming_seq).toBe(50);
    expect(setFloor).toHaveBeenCalledWith("PreThing", "naming_seq", 11, expect.anything());
    expect(setValue).not.toHaveBeenCalled();
  });

  it("honors a declared docstatus:1 on a seed row (A1)", async () => {
    const inserted = await seed({ "Widget.seed.json": [{ _id: "W1", name: "ok", docstatus: 1 }] });
    expect((inserted["Widget"] as Array<Record<string, unknown>>)[0]!["docstatus"]).toBe(1);
  });

  it("fails loud on an out-of-range docstatus (A1)", async () => {
    await expect(
      seed({ "Widget.seed.json": [{ _id: "W2", name: "x", docstatus: 5 }] }),
    ).rejects.toThrow(/docstatus/);
  });
});
