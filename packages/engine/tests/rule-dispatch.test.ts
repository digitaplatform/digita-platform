// F2 dispatch — integration proof that rules fire at the newly-wired lifecycle
// points inside the triggering transaction, that a set_value at validate is
// Zod-validated AND persisted on UPDATE (the _dirty regression), that a
// set_value at a post-write event fails loud, and that the (entity,event)
// cache honours a 30s TTL / clearRuleCache().
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test_ruledispatch",
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
import { clearRuleCache } from "../src/core/rules/rule-loader.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;

const admin: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin",
};

function widgetEntity(): EntityDefinition {
  return {
    name: "Widget",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "W-", pad_length: 4 },
    is_submittable: true,
    track_changes: false,
    states: [
      { value: "draft", color: "gray", is_initial: true, doc_status: 0 },
      { value: "active", color: "green", doc_status: 1 },
      { value: "closed", color: "red", doc_status: 2, is_terminal: true },
    ],
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "amount", fieldtype: "Int", label: "Amount" },
      { fieldname: "note", fieldtype: "Data", label: "Note" },
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "active", "closed"], default: "draft" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1 },
    ],
  } as EntityDefinition;
}

async function seedRule(rule: Record<string, unknown>): Promise<void> {
  await db.insertOne("Rule", { enabled: true, priority: 100, ...rule }, "core");
  clearRuleCache();
}

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
  await db.ensureCollection("Widget", "app");
  await db.ensureCollection("Rule", "core");

  registry = new EntityRegistry();
  const permissionChecker = new PermissionChecker(registry);
  const hookRunner = new HookRunner();
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db));
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  const cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);
  const workflowEngine = new WorkflowEngine(registry);
  const snapshotResolver = new SnapshotResolver(registry, db);
  const ruleEngine = new RuleEngine(db, registry);

  docService = new DocumentService({
    registry, db, permissionChecker, hookRunner,
    linkValidator, linkTitleResolver, fetchFromResolver,
    deleteProtection, cancelProtection, versionService, viewLogService,
    activityLogService, translationService, workflowEngine,
    snapshotResolver, ruleEngine,
  });
  hookRunner.setServices({ db, registry });
  hookRunner.setDocumentService(docService);
  ruleEngine.setDocumentService(docService);
  workflowEngine.setRuleEngine(ruleEngine);

  registry.register(widgetEntity());
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  await db.deleteMany("Widget", {}, "app");
  await db.deleteMany("Rule", {}, "core");
  await db.deleteMany("_sequences", {}, "app");
  clearRuleCache();
});

describe("validate rule rejects insert AND update (tx rolled back)", () => {
  it("rejects a bad insert and writes nothing", async () => {
    await seedRule({
      _id: "v-pos", entity: "Widget", event: "validate",
      actions: [{ type: "validate", condition: "doc.amount > 0", message: "amount must be positive" }],
    });
    await expect(
      docService.insert("Widget", { title: "T", amount: 0 }, admin),
    ).rejects.toThrow(/amount must be positive/);
    expect(await db.find("Widget", {}, "app")).toHaveLength(0);
  });

  it("rejects a bad update and leaves the stored doc unchanged", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await seedRule({
      _id: "v-pos", entity: "Widget", event: "validate",
      actions: [{ type: "validate", condition: "doc.amount > 0", message: "amount must be positive" }],
    });
    await expect(
      docService.update("Widget", doc._id, { amount: -1 }, admin),
    ).rejects.toThrow(/amount must be positive/);
    const stored = await db.findOne("Widget", doc._id, "app");
    expect(stored?.amount).toBe(5);
  });
});

describe("set_value at validate — Zod-validated AND persisted on UPDATE", () => {
  it("persists the mutation via getChanges() (the _dirty regression)", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await seedRule({
      _id: "sv-note", entity: "Widget", event: "validate",
      actions: [{ type: "set_value", field: "note", value: "'stamped'" }],
    });
    await docService.update("Widget", doc._id, { amount: 6 }, admin);
    const stored = await db.findOne("Widget", doc._id, "app");
    expect(stored?.note).toBe("stamped");
    expect(stored?.amount).toBe(6);
  });

  it("a set_value that violates Zod (bad Select option) rolls the update back", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5, status: "draft" }, admin);
    await seedRule({
      _id: "sv-bad", entity: "Widget", event: "validate",
      actions: [{ type: "set_value", field: "status", value: "'bogus'" }],
    });
    await expect(docService.update("Widget", doc._id, { amount: 6 }, admin)).rejects.toThrow();
    const stored = await db.findOne("Widget", doc._id, "app");
    expect(stored?.status).toBe("draft");
    expect(stored?.amount).toBe(5);
  });
});

describe("before_save / on_update / before_cancel fire at their points", () => {
  it("before_save rule fires on update", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await seedRule({
      _id: "bs", entity: "Widget", event: "before_save",
      actions: [{ type: "validate", condition: "doc.amount > 999999", message: "before_save-fired" }],
    });
    await expect(docService.update("Widget", doc._id, { amount: 6 }, admin)).rejects.toThrow(
      /before_save-fired/,
    );
  });

  it("on_update rule fires on update (post-write, rolls back)", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await seedRule({
      _id: "ou", entity: "Widget", event: "on_update",
      actions: [{ type: "validate", condition: "doc.amount > 999999", message: "on_update-fired" }],
    });
    await expect(docService.update("Widget", doc._id, { amount: 6 }, admin)).rejects.toThrow(
      /on_update-fired/,
    );
    expect((await db.findOne("Widget", doc._id, "app"))?.amount).toBe(5);
  });

  it("before_cancel rule fires on cancel", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await docService.submit("Widget", doc._id, admin);
    await seedRule({
      _id: "bc", entity: "Widget", event: "before_cancel",
      actions: [{ type: "validate", condition: "doc.amount > 999999", message: "before_cancel-fired" }],
    });
    await expect(docService.cancel("Widget", doc._id, admin)).rejects.toThrow(/before_cancel-fired/);
    expect((await db.findOne("Widget", doc._id, "app"))?.docstatus).toBe(1);
  });
});

describe("set_value at a post-write event fails loud", () => {
  it("a set_value rule at on_update throws at runtime (admin-overridden row)", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    // Inserted directly (bypasses the seed lint) to simulate a mongo override.
    await seedRule({
      _id: "sv-ou", entity: "Widget", event: "on_update",
      actions: [{ type: "set_value", field: "note", value: "'x'" }],
    });
    await expect(docService.update("Widget", doc._id, { amount: 6 }, admin)).rejects.toThrow(
      /set_value not allowed/,
    );
    expect((await db.findOne("Widget", doc._id, "app"))?.amount).toBe(5);
  });
});

describe("(entity,event) cache — TTL / clearRuleCache", () => {
  it("a rule deleted from mongo stays visible until the cache is cleared", async () => {
    const doc = await docService.insert("Widget", { title: "T", amount: 5 }, admin);
    await seedRule({
      _id: "cache", entity: "Widget", event: "validate",
      actions: [{ type: "validate", condition: "doc.amount > 999999", message: "cache-fired" }],
    });
    // Populate the cache + confirm the rule fires.
    await expect(docService.update("Widget", doc._id, { amount: 6 }, admin)).rejects.toThrow(
      /cache-fired/,
    );

    // Delete the rule WITHOUT clearing the cache → still served from cache.
    await db.deleteMany("Rule", {}, "core");
    await expect(docService.update("Widget", doc._id, { amount: 7 }, admin)).rejects.toThrow(
      /cache-fired/,
    );

    // Clear the cache → the rule is gone → the update succeeds.
    clearRuleCache();
    await docService.update("Widget", doc._id, { amount: 8 }, admin);
    expect((await db.findOne("Widget", doc._id, "app"))?.amount).toBe(8);
  });
});
