// A View saved through the document service passes the checks a View file passes at load, or it
// is refused with 400 naming the rule it breaks.
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test_viewsave",
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
import { ValidationFailedError } from "../src/core/document/document-service.js";
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
  await db.ensureCollection("View", "core");

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

  registry.register(widgetEntity());
  // The engine's own hooks, as the start loads them.
  await hookRunner.loadHooks(registry.getAll(), ["./src/modules"]);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  await db.deleteMany("Widget", {}, "app");
  await db.deleteMany("Rule", {}, "core");
  await db.deleteMany("View", {}, "core");
  await db.deleteMany("_sequences", {}, "app");
  clearRuleCache();
});


/** A Rule needs at least one action; this one passes every check. */
const VALID_ACTIONS = [{ type: "validate", condition: "doc.amount > 0", message: "amount must be positive" }];

/** An unanchored view of one list section with `limit`. */
const listView = (id: string, limit: number) => ({ _id: id, name: id, anchored: false, sections: [{ key: "rows", kind: "list", entity: "Widget", limit }] });

/** The refusal of a View save: the field it binds to and the reasons it names. */
async function refusal(save: Promise<unknown>): Promise<{ field: string; error: string | undefined }> {
  const err = await save.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationFailedError);
  const [first] = (err as ValidationFailedError).errors;
  expect(first?.message_key).toBe("view_invalid");
  return { field: first!.field, error: first!.params?.["error"] };
}

describe("a View saved through the document service", () => {
  it("PLANTED DEFECT: is refused when a list section has no limit, naming the section and the rule, and nothing is stored", async () => {
    const refused = await refusal(docService.insert("View", listView("no-limit", 0), admin));
    expect(refused).toMatchObject({ field: "sections", error: expect.stringContaining("sections[0].limit") });
    expect(await db.findOne("View", "no-limit", "core")).toBeNull();
  });

  it("is refused when its pipeline holds $unionWith", async () => {
    const view = {
      _id: "union", name: "Union", anchored: false,
      sections: [{ key: "x", kind: "aggregate", entity: "Widget", pipeline: [{ $unionWith: { coll: "secrets" } }] }],
    };
    expect((await refusal(docService.insert("View", view, admin))).error).toContain("$unionWith");
  });

  it("is refused on update, and the stored view keeps its limit", async () => {
    await docService.insert("View", listView("books", 20), admin);
    const sections = [{ key: "rows", kind: "list", entity: "Widget", limit: 0 }];
    await refusal(docService.update("View", "books", { sections }, admin));
    expect(((await db.findOne("View", "books", "core"))?.["sections"] as Array<{ limit: number }>)[0]?.limit).toBe(20);
  });

  it("PLANTED INNOCENT: is stored when it passes the checks", async () => {
    await docService.insert("View", listView("ok", 10), admin);
    expect(await db.findOne("View", "ok", "core")).not.toBeNull();
  });
});
