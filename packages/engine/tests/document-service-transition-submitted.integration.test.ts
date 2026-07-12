import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test", MODULES_DIR: "./src/modules", TRANSLATION_SOURCE: "file", TRANSLATION_FALLBACK_LOCALE: "en" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
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
import { WorkflowEngine, IllegalTransitionError } from "../src/core/workflow/workflow-engine.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES, DIGITA } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;

const admin: UserContext = { _id: "a", email: "admin@test.local", roles: [SYSTEM_ROLES.ADMINISTRATOR], full_name: "Admin" };
const salesManager: UserContext = { _id: "sm", email: "sm@test.local", roles: ["Sales Manager"], full_name: "Sales Mgr" };
const clerk: UserContext = { _id: "c", email: "clerk@test.local", roles: ["Clerk"], full_name: "Clerk" };

const fullPerms = { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 };

function orderEntity(name: string, sideEffects?: Record<string, unknown>): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "O-", pad_length: 4 },
    is_submittable: true,
    track_changes: true,
    workflow_field: "status",
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "grand_total", fieldtype: "Currency", label: "Grand total" }, // FROZEN
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "confirmed", "delivered", "cancelled"], default: "draft" },
      { fieldname: "delivered_at", fieldtype: "Datetime", label: "Delivered at", allow_on_submit: true },
    ],
    states: [
      { value: "draft", doc_status: 0, is_initial: true },
      { value: "confirmed", doc_status: 1, docstatus_default: true },
      { value: "delivered", doc_status: 1 },
      { value: "cancelled", doc_status: 2, is_terminal: true },
    ],
    transitions: [
      { from: "draft", to: "confirmed", action: "confirm", allowed_roles: [] },
      { from: "confirmed", to: "delivered", action: "deliver", allowed_roles: ["Sales Manager"], ...(sideEffects ? { side_effects: { set: sideEffects } } : {}) },
    ],
    permissions: [fullPerms],
  } as unknown as EntityDefinition;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_sequences", "app");
  await db.ensureCollection("_doc_guards", "core");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");

  registry = new EntityRegistry();
  const permissionChecker = new PermissionChecker(registry);
  const hookRunner = new HookRunner();
  hookRunner.setServices({ db, registry });
  const workflowEngine = new WorkflowEngine(registry);
  docService = new DocumentService({
    registry,
    db,
    permissionChecker,
    hookRunner,
    linkValidator: new LinkValidator(registry, db),
    linkTitleResolver: new LinkTitleResolver(registry, db, new TranslationService(db)),
    fetchFromResolver: new FetchFromResolver(registry, db),
    deleteProtection: new DeleteProtection(registry, db),
    cancelProtection: new CancelProtection(registry, db),
    versionService: new VersionService(db),
    viewLogService: new ViewLogService(db),
    activityLogService: new ActivityLogService(db),
    translationService: new TranslationService(db),
    workflowEngine,
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("transition() on a submitted doc (E5)", () => {
  beforeAll(async () => {
    registry.register(orderEntity("OrderDoc"));
    await db.ensureCollection("OrderDoc", "app");
  });

  async function submittedOrder(): Promise<string> {
    const doc = await docService.insert("OrderDoc", { title: "Ord", grand_total: 500 }, admin);
    await docService.submit("OrderDoc", doc._id, admin);
    // submit flips the workflow field to the first doc_status=1 state (confirmed)
    const raw = await db.findOne("OrderDoc", doc._id, "app");
    expect(raw?.["status"]).toBe("confirmed");
    expect(raw?.["docstatus"]).toBe(1);
    return doc._id;
  }

  it("T14a: a doc_status-1 → doc_status-1 transition succeeds for an allowed role, with version + activity", async () => {
    const id = await submittedOrder();
    await docService.transition("OrderDoc", id, "delivered", salesManager);
    const raw = await db.findOne("OrderDoc", id, "app");
    expect(raw?.["status"]).toBe("delivered");
    expect(raw?.["docstatus"]).toBe(1); // still submitted

    const versions = await db.find(
      "_versions",
      { filters: [{ entity: "OrderDoc", document_name: id }], order_by: "timestamp desc", limit: 5 },
      DIGITA.DATABASES.AUDITS,
    );
    expect(versions.length).toBeGreaterThan(0);
    const logs = await db.find(
      DIGITA.COLLECTIONS.LOG,
      { filters: [{ entity: "OrderDoc", document_name: id, action: "Updated" }], order_by: "creation desc", limit: 5 },
      "logs",
    );
    expect((logs[0] as { details: Record<string, unknown> }).details["post_submit"]).toBe(true);
  });

  it("T14b: an unauthorized role is denied (role_denied)", async () => {
    const id = await submittedOrder();
    await expect(docService.transition("OrderDoc", id, "delivered", clerk)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    await expect(docService.transition("OrderDoc", id, "delivered", clerk)).rejects.toMatchObject({
      reason: "role_denied",
    });
    const raw = await db.findOne("OrderDoc", id, "app");
    expect(raw?.["status"]).toBe("confirmed"); // unchanged
  });

  it("T14c: a move that would change docstatus is rejected (use cancel/amend)", async () => {
    const id = await submittedOrder();
    await expect(docService.transition("OrderDoc", id, "cancelled", admin)).rejects.toMatchObject({
      messageKey: "transition_requires_docstatus_verb",
    });
  });

  it("T14d: the draft transition path is unchanged (routes through update, docstatus stays 0)", async () => {
    const doc = await docService.insert("OrderDoc", { title: "Draft", grand_total: 1 }, admin);
    await docService.transition("OrderDoc", doc._id, "confirmed", admin);
    const raw = await db.findOne("OrderDoc", doc._id, "app");
    expect(raw?.["status"]).toBe("confirmed");
    expect(raw?.["docstatus"]).toBe(0); // never submitted — plain update path
  });
});

describe("transition() side_effects on a submitted doc (E5 / §4 step 15)", () => {
  it("T15a: band-conformant side_effects.set persists", async () => {
    registry.register(orderEntity("OrderGood", { delivered_at: "2026-06-20T10:00:00.000Z" }));
    await db.ensureCollection("OrderGood", "app");
    const doc = await docService.insert("OrderGood", { title: "G", grand_total: 1 }, admin);
    await docService.submit("OrderGood", doc._id, admin);
    await docService.transition("OrderGood", doc._id, "delivered", salesManager);
    const raw = await db.findOne("OrderGood", doc._id, "app");
    expect(raw?.["status"]).toBe("delivered");
    expect(raw?.["delivered_at"]).toBeTruthy();
  });

  it("T15b: a non-band side_effects.set field aborts the tx", async () => {
    registry.register(orderEntity("OrderBad", { grand_total: 999 })); // frozen field
    await db.ensureCollection("OrderBad", "app");
    const doc = await docService.insert("OrderBad", { title: "B", grand_total: 1 }, admin);
    await docService.submit("OrderBad", doc._id, admin);
    await expect(
      docService.transition("OrderBad", doc._id, "delivered", salesManager),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });
    const raw = await db.findOne("OrderBad", doc._id, "app");
    expect(raw?.["status"]).toBe("confirmed"); // aborted — unchanged
    expect(raw?.["grand_total"]).toBe(1);
  });
});
