// The tree rules of the engine: cycle, partition and depth, and the place of every node.
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test_treerules",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { HookRunner } from "../src/core/hooks/hook-runner.js";
import { decryptPassword } from "../src/core/entity/password-cipher.js";
import { LinkValidator } from "../src/core/link/link-validator.js";
import { LinkTitleResolver } from "../src/core/link/link-title-resolver.js";
import { FetchFromResolver } from "../src/core/fetch/fetch-from-resolver.js";
import { DeleteProtection } from "../src/core/link/delete-protection.js";
import { CancelProtection } from "../src/core/link/cancel-protection.js";
import { VersionService } from "../src/core/version/version-service.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { WorkflowEngine } from "../src/core/workflow/workflow-engine.js";
import { SnapshotResolver } from "../src/core/snapshot/snapshot-resolver.js";
import { RuleEngine } from "../src/core/rules/rule-engine.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";
import { TreeRefusedError } from "../src/core/tree/tree-rules.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";
import { NamingService } from "../src/core/document/naming-service.js";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// The engine keeps a tree a tree, whoever writes it: an insert, a PUT, an import or a rule, and
// the seed, which writes raw.
let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;

const admin: UserContext = { _id: "admin-001", email: "admin@test.local", roles: [SYSTEM_ROLES.ADMINISTRATOR], full_name: "Admin" };
const perms = [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }];
const tree = (name: string, config: Record<string, unknown>) =>
  ({ name, module: "test", database: "app", naming: { strategy: "user_set" }, tree: config, fields: [], permissions: perms }) as unknown as EntityDefinition;
const groupEntity = () => tree("TGroup", {});
const kindEntity = () => tree("TKindGroup", { kind: true });
const shallowEntity = () => tree("TShallow", { max_depth: 3 });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_sequences", "app");
  await db.ensureCollection("_sequences", "core");
  await db.ensureCollection("_doc_guards", "core");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");
  await db.ensureCollection("Rule", "core");

  registry = new EntityRegistry();
  await registry.loadAll("./src/entities");
  const permissionChecker = new PermissionChecker(registry);
  const hookRunner = new HookRunner();
  const linkValidator = new LinkValidator(registry, db, permissionChecker);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db), permissionChecker);
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  const cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);
  const workflowEngine = new WorkflowEngine();
  const snapshotResolver = new SnapshotResolver(registry, db);
  const ruleEngine = new RuleEngine(db, registry);

  docService = new DocumentService({
    tenantTimeZone: () => "UTC",
    registry, db, permissionChecker, hookRunner,
    linkValidator, linkTitleResolver, fetchFromResolver,
    deleteProtection, cancelProtection, versionService, viewLogService,
    activityLogService, translationService, workflowEngine,
    snapshotResolver, ruleEngine,
  });
  hookRunner.setServices({ db, registry, decryptPassword });
  hookRunner.setDocumentService(docService);
  ruleEngine.setDocumentService(docService);
  workflowEngine.setRuleEngine(ruleEngine);

  for (const entity of [groupEntity(), kindEntity(), shallowEntity()]) {
    registry.prepareDefinition(entity);
    registry.register(entity);
    await db.ensureCollection(entity.name, "app");
  }
  // The engine's own hooks, as the start loads them.
  await hookRunner.loadHooks(registry.getAll(), ["./src/modules"]);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  for (const name of ["TGroup", "TKindGroup", "TShallow"]) await db.deleteMany(name, {}, "app");
});

const add = (entity: string, _id: string, parent: string | null, extra: Record<string, unknown> = {}) =>
  docService.insert(entity, { _id, label: _id, parent, ...extra }, admin);
const stored = async (entity: string, id: string) => (await db.findOne(entity, id, "app")) as Record<string, unknown>;
const place = async (entity: string, id: string) => {
  const row = await stored(entity, id);
  return [row["_ancestors"], row["_depth"]];
};
const refusal = async (write: Promise<unknown>) => {
  const err = await write.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(TreeRefusedError);
  return (err as TreeRefusedError).responseCode;
};

describe("a node's place", () => {
  it("is written on insert: the ancestors from the root and the level", async () => {
    await add("TGroup", "A", null);
    await add("TGroup", "B", "A");
    await add("TGroup", "C", "B");
    expect(await place("TGroup", "C")).toEqual([["A", "B"], 3]);
    expect(await place("TGroup", "A")).toEqual([[], 1]);
  });

  it("ignores a client's ancestors, level and revision, on insert and on update", async () => {
    await add("TGroup", "A", null);
    await docService.insert("TGroup", { _id: "B", label: "B", parent: "A", _ancestors: ["X"], _depth: 9, _tree_rev: 99 }, admin);
    expect(await place("TGroup", "B")).toEqual([["A"], 2]);
    await docService.update("TGroup", "B", { label: "B2", _ancestors: ["Y"], _depth: 7 }, admin);
    expect(await place("TGroup", "B")).toEqual([["A"], 2]);
  });
});

describe("a cycle", () => {
  it("is refused through an update that moves a node under its own grandchild, and under itself", async () => {
    await add("TGroup", "A", null);
    await add("TGroup", "B", "A");
    await add("TGroup", "C", "B");
    expect(await refusal(docService.update("TGroup", "A", { parent: "C" }, admin))).toBe("TREE_CYCLE");
    expect(await refusal(docService.update("TGroup", "B", { parent: "B" }, admin))).toBe("TREE_CYCLE");
    expect((await stored("TGroup", "A"))["parent"] ?? null).toBeNull();
  });

  it("is refused for exactly one of two moves that would close it at the same time", async () => {
    await add("TGroup", "X", null);
    await add("TGroup", "Y", null);
    // Both moves read the tree before either writes: each write waits until both have arrived.
    const original = db.updateOne.bind(db);
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.spyOn(db, "updateOne").mockImplementation(async (...args) => {
      if (args[0] === "TGroup" && "parent" in (args[2] as object)) {
        if (++arrived === 2) release();
        await Promise.race([bothRead, new Promise((r) => setTimeout(r, 2000))]);
      }
      return original(...args);
    });
    try {
      const results = await Promise.allSettled([
        docService.update("TGroup", "X", { parent: "Y" }, admin),
        docService.update("TGroup", "Y", { parent: "X" }, admin),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((refused.reason as TreeRefusedError).responseCode).toBe("TREE_CYCLE");
    } finally {
      spy.mockRestore();
    }
    const parents = [(await stored("TGroup", "X"))["parent"] ?? null, (await stored("TGroup", "Y"))["parent"] ?? null];
    expect(parents.filter(Boolean)).toHaveLength(1);
  });
});

describe("a node's tree", () => {
  it("refuses a parent of another kind", async () => {
    await add("TKindGroup", "S", null, { kind: "sales" });
    expect(await refusal(add("TKindGroup", "P", "S", { kind: "purchase" }))).toBe("TREE_PARTITION");
  });

  it("changes a kind only on a root without children", async () => {
    await add("TKindGroup", "S", null, { kind: "sales" });
    await add("TKindGroup", "S1", "S", { kind: "sales" });
    expect(await refusal(docService.update("TKindGroup", "S1", { kind: "purchase" }, admin))).toBe("TREE_PARTITION");
    expect(await refusal(docService.update("TKindGroup", "S", { kind: "purchase" }, admin))).toBe("TREE_PARTITION");
    await add("TKindGroup", "L", null, { kind: "sales" });
    await docService.update("TKindGroup", "L", { kind: "purchase" }, admin);
    expect((await stored("TKindGroup", "L"))["kind"]).toBe("purchase");
  });
});

describe("a tree's depth", () => {
  it("refuses a node below the deepest level, and a move that pushes a grandchild past it", async () => {
    await add("TShallow", "A", null);
    await add("TShallow", "B", "A");
    await add("TShallow", "C", "B");
    expect(await refusal(add("TShallow", "D", "C"))).toBe("TREE_TOO_DEEP");
    await add("TShallow", "R", null);
    await add("TShallow", "R1", "R");
    await add("TShallow", "R2", "R1");
    expect(await refusal(docService.update("TShallow", "R", { parent: "A" }, admin))).toBe("TREE_TOO_DEEP");
  });

  it("PLANTED INNOCENT: takes a move that ends exactly at the deepest level", async () => {
    await add("TShallow", "A", null);
    await add("TShallow", "R", null);
    await add("TShallow", "R1", "R");
    await docService.update("TShallow", "R", { parent: "A" }, admin);
    expect(await place("TShallow", "R1")).toEqual([["A", "R"], 3]);
  });
});

describe("a move", () => {
  it("rewrites a 20-node subtree in one update", async () => {
    await add("TGroup", "N", null);
    await add("TGroup", "M", null);
    let parent = "N";
    for (let i = 1; i <= 20; i++) {
      await add("TGroup", `N${i}`, i % 2 ? "N" : parent);
      if (i % 2) parent = `N${i}`;
    }
    const spy = vi.spyOn(db, "updateMany");
    try {
      await docService.update("TGroup", "N", { parent: "M" }, admin);
      const subtree = spy.mock.calls.filter(([collection]) => collection === "TGroup");
      expect(subtree).toHaveLength(1);
      expect(await spy.mock.results[0]!.value).toBe(20);
    } finally {
      spy.mockRestore();
    }
    for (let i = 1; i <= 20; i++) expect(((await stored("TGroup", `N${i}`))["_ancestors"] as string[]).slice(0, 2)).toEqual(["M", "N"]);
  });
});

describe("a seeded tree", () => {
  it("gets its places from the seed, so a move of a middle node holds its subtree and its depth", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tree-seed-"));
    await mkdir(join(dir, "seeds"));
    await writeFile(
      join(dir, "seeds", "TShallow.seed.json"),
      JSON.stringify([
        { _id: "A", label: "A", parent: null },
        { _id: "B", label: "B", parent: "A" },
        { _id: "C", label: "C", parent: "B" },
        { _id: "Z", label: "Z", parent: null },
        { _id: "Z1", label: "Z1", parent: "Z" },
      ]),
    );
    await seedAppData(db, registry, new NamingService(db), [join(dir, "seeds")]);
    await rm(dir, { recursive: true, force: true });
    expect(await place("TShallow", "C")).toEqual([["A", "B"], 3]);
    // B with its child C under Z1 would end at level 4.
    expect(await refusal(docService.update("TShallow", "B", { parent: "Z1" }, admin))).toBe("TREE_TOO_DEEP");
    await docService.update("TShallow", "B", { parent: "Z" }, admin);
    expect(await place("TShallow", "C")).toEqual([["Z", "B"], 3]);
  });
});
