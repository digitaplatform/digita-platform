import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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

import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";

/** A db that stores what the seed inserts, so a later file sees the earlier file's rows. */
function mockDb() {
  const stored = new Map<string, Record<string, unknown>>();
  const db = {
    find: vi.fn(async () => [...stored.values()]),
    findOne: vi.fn(async (_coll: string, id: string) => stored.get(id) ?? null),
    insertMany: vi.fn(async (_coll: string, docs: Array<Record<string, unknown>>) => {
      for (const doc of docs) if (!stored.has(String(doc["_id"]))) stored.set(String(doc["_id"]), doc);
    }),
    getNextSequence: vi.fn(async () => 1),
    setSequenceValue: vi.fn(async () => {}),
    setSequenceFloor: vi.fn(async () => {}),
    deleteMany: vi.fn(async () => 0),
  } as unknown as MongoDBService;
  return { db, stored };
}

describe("a by_field seed row without _id is named by its field (Role)", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "digita-seed-by-field-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("seeds the roles of two domains, each under its name", async () => {
    const registry = new EntityRegistry();
    registry.register(JSON.parse(await readFile(new URL("../src/entities/Role.entity.json", import.meta.url), "utf-8")) as EntityDefinition);
    for (const [domain, role] of [["library", "Librarian"], ["shop", "Cashier"]] as const) {
      await mkdir(join(root, domain), { recursive: true });
      await writeFile(join(root, domain, "Role.seed.json"), JSON.stringify([{ name: role, label: role }]), "utf-8");
    }
    const { db, stored } = mockDb();

    await seedAppData(db, registry, {} as NamingService, [join(root, "library"), join(root, "shop")]);

    expect([...stored.keys()].sort()).toEqual(["Cashier", "Librarian"]);
  });

  it("skips a file with a row that has neither an _id nor its naming field", async () => {
    const registry = new EntityRegistry();
    registry.register(JSON.parse(await readFile(new URL("../src/entities/Role.entity.json", import.meta.url), "utf-8")) as EntityDefinition);
    await mkdir(join(root, "library"), { recursive: true });
    await writeFile(join(root, "library", "Role.seed.json"), JSON.stringify([{ name: "Librarian" }, { label: "no name" }]), "utf-8");
    const { db, stored } = mockDb();

    await seedAppData(db, registry, {} as NamingService, [join(root, "library")]);

    expect([...stored.keys()]).toEqual([]);
  });
});
