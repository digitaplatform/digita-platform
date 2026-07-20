// Lifecycle-order tests for HookRunner + DocumentService.
// Records every hook invocation (event name + key state on the doc) into a
// shared call-log, then asserts the log matches the lifecycle table from
// docs/HOOK-LIFECYCLE-AUDIT.md Section 1.
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test_lifecycle",
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
import type { BaseDocument } from "../src/core/document/base-document.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;
let hookRunner: HookRunner;

const adminUser: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin User",
};

interface CallEvent {
  event: string;
  isNew: boolean;
  hasId: boolean;
  hasSession: boolean;
  docstatus: number;
}

const calls: CallEvent[] = [];

function record(event: string) {
  return async (
    doc: BaseDocument,
    _ctx: unknown,
    services?: { session?: unknown },
  ): Promise<void> => {
    calls.push({
      event,
      isNew: doc._isNew,
      hasId: doc._id !== "" && doc._id != null,
      hasSession: services?.session != null,
      docstatus: doc.docstatus,
    });
  };
}

function makeEntity(): EntityDefinition {
  return {
    name: "LifecycleProbe",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "LP-", pad_length: 4 },
    is_submittable: true,
    track_changes: false,
    states: [
      { value: "draft", color: "gray", is_initial: true, doc_status: 0 },
      { value: "active", color: "green", doc_status: 1 },
      { value: "closed", color: "red", doc_status: 2, is_terminal: true },
    ],
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "amount", fieldtype: "Currency", label: "Amount" },
      { fieldname: "computed_double", fieldtype: "Currency", label: "Doubled", read_only: true },
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "active", "closed"], default: "draft" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1 },
    ],
    hooks: {
      validate: "stub.validate" as never,
      before_insert: "stub.before_insert" as never,
      after_insert: "stub.after_insert" as never,
      before_save: "stub.before_save" as never,
      on_update: "stub.on_update" as never,
      before_submit: "stub.before_submit" as never,
      on_submit: "stub.on_submit" as never,
      before_cancel: "stub.before_cancel" as never,
      on_cancel: "stub.on_cancel" as never,
      on_change: "stub.on_change" as never,
      computed: { computed_double: "stub.computed" as never },
    },
  } as EntityDefinition;
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

  registry = new EntityRegistry();
  const permissionChecker = new PermissionChecker(registry);
  hookRunner = new HookRunner();
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db));
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  const cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);
  const workflowEngine = new WorkflowEngine();
  const snapshotResolver = new SnapshotResolver(registry, db);

  docService = new DocumentService({
    registry, db, permissionChecker, hookRunner,
    linkValidator, linkTitleResolver, fetchFromResolver,
    deleteProtection, cancelProtection, versionService, viewLogService,
    activityLogService, translationService, workflowEngine,
    snapshotResolver,
  });

  hookRunner.setServices({ db, registry });
  hookRunner.setDocumentService(docService);

  registry.register(makeEntity());
  await db.ensureCollection("LifecycleProbe", "app");

  // Manually register hooks (bypass file loader) into the runner's
  // internal map. This keeps the test self-contained — no fixture files
  // on disk, just in-memory recording functions.
  const entityHooks = new Map<string, (...args: unknown[]) => Promise<void>>();
  entityHooks.set("validate", record("validate") as never);
  entityHooks.set("before_insert", record("before_insert") as never);
  entityHooks.set("after_insert", record("after_insert") as never);
  entityHooks.set("before_save", record("before_save") as never);
  entityHooks.set("on_update", record("on_update") as never);
  entityHooks.set("before_submit", record("before_submit") as never);
  entityHooks.set("on_submit", record("on_submit") as never);
  entityHooks.set("before_cancel", record("before_cancel") as never);
  entityHooks.set("on_cancel", record("on_cancel") as never);
  entityHooks.set("on_change", record("on_change") as never);
  entityHooks.set("computed:computed_double", (async (
    doc: BaseDocument,
    ctx: unknown,
    services?: { session?: unknown },
  ) => {
    await record("computed:computed_double")(doc, ctx, services);
    const a = Number(doc.get("amount") ?? 0);
    doc.set("computed_double", a * 2);
  }) as never);
  (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set("LifecycleProbe", entityHooks as never);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(async () => {
  await db.deleteMany("LifecycleProbe", {}, "app");
  await db.deleteMany("_sequences", {}, "app");
  calls.length = 0;
});

// ────────────────────────────────────────────────────────────────────
// INSERT lifecycle (audit Section 1.1)
// ────────────────────────────────────────────────────────────────────

describe("INSERT lifecycle", () => {
  it("fires hooks in the documented order", async () => {
    await docService.insert("LifecycleProbe", { title: "T", amount: 10 }, adminUser);
    const events = calls.map((c) => c.event);
    // computed runs before validate; validate before before_insert; after_insert
    // and on_change last. (The doubling hook is stub.computed under "computed:" prefix.)
    expect(events).toEqual([
      "computed:computed_double",
      "validate",
      "before_insert",
      "after_insert",
      "on_change",
    ]);
  });

  it("validate runs with empty _id (naming hasn't run yet)", async () => {
    await docService.insert("LifecycleProbe", { title: "T", amount: 1 }, adminUser);
    const validate = calls.find((c) => c.event === "validate")!;
    expect(validate.hasId).toBe(false);
    expect(validate.isNew).toBe(true);
  });

  it("after_insert runs with assigned _id and isNew still true", async () => {
    await docService.insert("LifecycleProbe", { title: "T", amount: 1 }, adminUser);
    const after = calls.find((c) => c.event === "after_insert")!;
    expect(after.hasId).toBe(true);
    expect(after.isNew).toBe(true);
  });

  it("hooks run inside a transaction (services.session is present)", async () => {
    await docService.insert("LifecycleProbe", { title: "T", amount: 1 }, adminUser);
    for (const c of calls) {
      expect({ event: c.event, hasSession: c.hasSession }).toEqual({ event: c.event, hasSession: true });
    }
  });

  it("computed hook output is persisted (computed_double = 2 × amount)", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 7 }, adminUser);
    const stored = await db.findOne("LifecycleProbe", doc._id, "app");
    expect(stored?.computed_double).toBe(14);
  });
});

// ────────────────────────────────────────────────────────────────────
// business_key_series generation must see fields a before_insert hook sets
// ────────────────────────────────────────────────────────────────────
// A `business_key_series` expression (e.g. "SP-{####:label}") partitions its
// counter by a field on the document. That field may only be populated by a
// `before_insert` hook (a stamp/default that depends on other already-
// validated data) — the caller never supplies it directly. The naming step
// must therefore run AFTER before_insert so it observes hook-set fields.

function makeSeriesEntity(): EntityDefinition {
  return {
    name: "SeriesProbe",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "SP-ID-", pad_length: 4 },
    business_key: "doc_no",
    business_key_series: "SP-{####:label}",
    fields: [
      { fieldname: "doc_no", fieldtype: "Data", label: "Doc No", read_only: true },
      { fieldname: "label", fieldtype: "Data", label: "Label" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    ],
    hooks: {
      before_insert: "stub.stamp_label" as never,
    },
  } as EntityDefinition;
}

describe("business_key_series generation ordered after before_insert", () => {
  beforeAll(async () => {
    registry.register(makeSeriesEntity());
    await db.ensureCollection("SeriesProbe", "app");

    // Manually registered stand-in hook (same pattern as the top-level
    // beforeAll): stamps the series-partition field only when the caller
    // didn't supply it, mirroring a real default/stamp hook.
    const seriesHooks = new Map<string, (...args: unknown[]) => Promise<void>>();
    seriesHooks.set("before_insert", (async (doc: BaseDocument) => {
      if (doc.get("label") == null || doc.get("label") === "") {
        doc.set("label", "batch1");
      }
    }) as never);
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "SeriesProbe",
      seriesHooks as never,
    );
  });

  it("lets a before_insert hook populate the field the naming series partitions on", async () => {
    const doc = await docService.insert("SeriesProbe", {}, adminUser);
    expect(doc._data["label"]).toBe("batch1");
    expect(doc._data["doc_no"]).toMatch(/^SP-batch1-\d+$/);
  });
});

// ────────────────────────────────────────────────────────────────────
// UPDATE lifecycle (audit Section 1.2)
// ────────────────────────────────────────────────────────────────────

describe("UPDATE lifecycle", () => {
  it("fires before_save (not on insert) + on_update in correct order", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.update("LifecycleProbe", doc._id, { amount: 8 }, adminUser);
    const events = calls.map((c) => c.event);
    expect(events).toEqual([
      "computed:computed_double",
      "validate",
      "before_save",
      "on_update",
      "on_change",
    ]);
  });

  it("update with NO field changes still fires the lifecycle (computed runs anyway)", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.update("LifecycleProbe", doc._id, { amount: 5 }, adminUser); // same value
    const events = calls.map((c) => c.event);
    expect(events).toContain("computed:computed_double");
    expect(events).toContain("validate");
    expect(events).toContain("on_update");
  });

  it("after update, _isNew is false and _id is preserved", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.update("LifecycleProbe", doc._id, { amount: 8 }, adminUser);
    const validate = calls.find((c) => c.event === "validate")!;
    expect(validate.isNew).toBe(false);
    expect(validate.hasId).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// SUBMIT lifecycle (audit Section 1.3)
// ────────────────────────────────────────────────────────────────────

describe("SUBMIT lifecycle", () => {
  it("validate INSIDE transaction, then before_submit, on_submit, on_change", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    const events = calls.map((c) => c.event);
    // Insert path doesn't fire on submit, only the submit-specific hooks.
    expect(events).toEqual([
      "validate",
      "before_submit",
      "computed:computed_double",     // re-run after snapshot
      "on_submit",
      "on_change",
    ]);
  });

  it("validate gets a session", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    const validate = calls.find((c) => c.event === "validate")!;
    expect(validate.hasSession).toBe(true);
  });

  it("on_submit sees docstatus=1 (status flip already applied)", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    calls.length = 0;
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    const onSubmit = calls.find((c) => c.event === "on_submit")!;
    expect(onSubmit.docstatus).toBe(1);
  });

  it("workflow status auto-transitions from 'draft' to 'active' (doc_status=1 non-terminal)", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    expect((await db.findOne("LifecycleProbe", doc._id, "app"))?.status).toBe("draft");
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    expect((await db.findOne("LifecycleProbe", doc._id, "app"))?.status).toBe("active");
  });

  it("computed re-runs after snapshot — derived field reflects pre-submit state", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    // Bypass docService to directly mutate amount (simulating a snapshot side-effect).
    await db.updateOne("LifecycleProbe", doc._id, { amount: 100 }, "app");
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    const stored = await db.findOne("LifecycleProbe", doc._id, "app");
    expect(stored?.computed_double).toBe(200); // computed re-ran
  });
});

// ────────────────────────────────────────────────────────────────────
// CANCEL lifecycle (audit Section 1.4)
// ────────────────────────────────────────────────────────────────────

describe("CANCEL lifecycle", () => {
  it("before_cancel, on_cancel, on_change in order — all in transaction", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    calls.length = 0;
    await docService.cancel("LifecycleProbe", doc._id, adminUser);
    const events = calls.map((c) => c.event);
    expect(events).toEqual(["before_cancel", "on_cancel", "on_change"]);
    expect(calls.every((c) => c.hasSession)).toBe(true);
  });

  it("on_cancel sees docstatus=2", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    calls.length = 0;
    await docService.cancel("LifecycleProbe", doc._id, adminUser);
    const onCancel = calls.find((c) => c.event === "on_cancel")!;
    expect(onCancel.docstatus).toBe(2);
  });

  it("workflow status auto-transitions to 'closed' (doc_status=2)", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);
    await docService.submit("LifecycleProbe", doc._id, adminUser);
    expect((await db.findOne("LifecycleProbe", doc._id, "app"))?.status).toBe("active");
    await docService.cancel("LifecycleProbe", doc._id, adminUser);
    expect((await db.findOne("LifecycleProbe", doc._id, "app"))?.status).toBe("closed");
  });
});

// ────────────────────────────────────────────────────────────────────
// CROSS-CUTTING — hook errors roll back the transaction
// ────────────────────────────────────────────────────────────────────

describe("transaction rollback on hook failure", () => {
  it("a throwing on_submit rolls back the docstatus flip", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);

    // Override on_submit to throw.
    const originalHooks = (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks;
    const probeHooks = originalHooks.get("LifecycleProbe")!;
    const original = probeHooks.get("on_submit") as never;
    probeHooks.set("on_submit", (async () => { throw new Error("boom"); }) as never);

    try {
      await expect(
        docService.submit("LifecycleProbe", doc._id, adminUser),
      ).rejects.toThrow(/boom/);
    } finally {
      probeHooks.set("on_submit", original);
    }

    const stored = await db.findOne("LifecycleProbe", doc._id, "app");
    expect(stored?.docstatus).toBe(0); // rolled back
    expect(stored?.status).toBe("draft");
  });

  it("a throwing validate on update rolls back changes", async () => {
    const doc = await docService.insert("LifecycleProbe", { title: "T", amount: 5 }, adminUser);

    const originalHooks = (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks;
    const probeHooks = originalHooks.get("LifecycleProbe")!;
    const original = probeHooks.get("validate") as never;
    probeHooks.set("validate", (async () => { throw new Error("validation kaboom"); }) as never);

    try {
      await expect(
        docService.update("LifecycleProbe", doc._id, { amount: 999 }, adminUser),
      ).rejects.toThrow(/kaboom/);
    } finally {
      probeHooks.set("validate", original);
    }

    const stored = await db.findOne("LifecycleProbe", doc._id, "app");
    expect(stored?.amount).toBe(5); // unchanged
  });
});
