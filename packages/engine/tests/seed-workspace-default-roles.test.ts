// An app seeds a Workspace for roles ["Staff"] that is the default for ["Staff", "Manager"]. A person
// who holds only Manager gets it named as their default, but the role list hides it from them: Home
// stays empty and nothing says why. The seeder refuses such a seed when the app loads.
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
  reg.register(entity({ name: "Workspace", role_visibility_field: "roles" }));
  return reg;
}

const errorCalls = () => logSpy.error.mock.calls as Array<[Record<string, unknown>, string]>;

describe("a Workspace seed and its default roles", () => {
  let dir: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(join(tmpdir(), "digita-seed-workspace-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(rows: unknown[]) {
    await writeFile(join(dir, "Workspace.seed.json"), JSON.stringify(rows), "utf-8");
    const { db, inserted } = mockDb();
    await seedAppData(db, registry(), {} as NamingService, [dir]);
    return inserted;
  }

  it("refuses a row whose default roles its role list leaves out, naming the workspace, the role and both fields", async () => {
    const inserted = await seed([
      { _id: "front_desk", name: "Front desk", roles: ["Staff"], is_default_for_roles: ["Staff", "Manager"] },
    ]);
    expect(inserted["Workspace"]).toBeUndefined();
    const hit = errorCalls().find((c) => c[0]?.["entity"] === "Workspace");
    expect(hit?.[0]).toMatchObject({ workspace: "front_desk", role: "Manager" });
    expect(hit?.[1]).toMatch(/front_desk/);
    expect(hit?.[1]).toMatch(/Manager/);
    expect(hit?.[1]).toMatch(/is_default_for_roles/);
    expect(hit?.[1]).toMatch(/\broles\b/);
  });

  it("seeds a row whose default roles lie within its role list", async () => {
    const inserted = await seed([
      { _id: "front_desk", name: "Front desk", roles: ["Staff", "Manager"], is_default_for_roles: ["Manager"] },
    ]);
    expect(inserted["Workspace"]).toHaveLength(1);
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("seeds a row without a role list or with an empty one, whose readers its permission rows decide", async () => {
    const inserted = await seed([
      { _id: "home", name: "Home", is_default_for_roles: ["Manager"] },
      { _id: "office", name: "Office", roles: [], is_default_for_roles: ["Manager"] },
    ]);
    expect(inserted["Workspace"]).toHaveLength(2);
    expect(logSpy.error).not.toHaveBeenCalled();
  });
});
