import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

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
import { WorkflowEngine } from "../src/core/workflow/workflow-engine.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService, NotFoundError, DeleteBlockedError, ValidationFailedError, ActionHandlerMissingError } from "../src/core/document/document-service.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import { DocumentShareService } from "../src/core/permissions/document-share-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES, DIGITA } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;
let cancelProtection: CancelProtection;

const adminUser: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin User",
};

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "TestDoc",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "TD-", pad_length: 4 },
    is_submittable: false,
    is_log: false,
    track_changes: false,
    track_views: false,
    fields: [
      { fieldname: "title", fieldtype: "Data" as const, label: "Title", required: true },
      { fieldname: "status", fieldtype: "Select" as const, label: "Status", options: ["Draft", "Active", "Closed"], default: "Draft" },
      { fieldname: "amount", fieldtype: "Currency" as const, label: "Amount" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
    ],
    ...overrides,
  } as EntityDefinition;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();

  // Ensure system collections exist
  await db.ensureCollection("_sequences", "app");
  await db.ensureCollection("_sequences", "core");
  await db.ensureCollection("_doc_guards", "core");
  await db.ensureCollection("_sequences", "logs");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");

  registry = new EntityRegistry();

  const permissionChecker = new PermissionChecker(registry);
  const hookRunner = new HookRunner();
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db));
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);
  const workflowEngine = new WorkflowEngine();

  docService = new DocumentService({
    registry,
    db,
    permissionChecker,
    hookRunner,
    linkValidator,
    linkTitleResolver,
    fetchFromResolver,
    deleteProtection,
    cancelProtection,
    versionService,
    viewLogService,
    activityLogService,
    translationService,
    workflowEngine,
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("DocumentService Integration", () => {
  // ── INSERT ────────────────────────────────────────────────

  describe("insert", () => {
    beforeEach(async () => {
      const entity = makeEntity({ name: "InsertDoc" });
      registry.register(entity);
      await db.ensureCollection("InsertDoc", "app");
    });

    it("inserts a document and assigns _id", async () => {
      const doc = await docService.insert("InsertDoc", { title: "First Doc" }, adminUser);

      expect(doc._id).toMatch(/^TD-\d{4}$/);
      expect(doc.doctype).toBe("InsertDoc");
      expect(doc.docstatus).toBe(0);
      expect(doc.owner).toBe("admin@test.local");
      expect(doc.modified_by).toBe("admin@test.local");
      expect(doc.creation).toBeInstanceOf(Date);
      expect(doc.modified).toBeInstanceOf(Date);
    });

    it("persists the document to MongoDB", async () => {
      const doc = await docService.insert("InsertDoc", { title: "Persisted" }, adminUser);

      const raw = await db.findOne("InsertDoc", doc._id, "app");
      expect(raw).not.toBeNull();
      expect((raw as Record<string, unknown>)["title"]).toBe("Persisted");
    });

    it("applies default values from entity definition", async () => {
      const doc = await docService.insert("InsertDoc", { title: "With Defaults" }, adminUser);

      expect(doc._data["status"]).toBe("Draft");
    });

    it("increments _id sequence across multiple inserts", async () => {
      const doc1 = await docService.insert("InsertDoc", { title: "A" }, adminUser);
      const doc2 = await docService.insert("InsertDoc", { title: "B" }, adminUser);

      const num1 = parseInt(doc1._id.replace("TD-", ""), 10);
      const num2 = parseInt(doc2._id.replace("TD-", ""), 10);
      expect(num2).toBe(num1 + 1);
    });
  });

  // ── GET DOC ───────────────────────────────────────────────

  describe("getDoc", () => {
    let insertedId: string;

    beforeEach(async () => {
      const entity = makeEntity({ name: "GetDoc" });
      registry.register(entity);
      await db.ensureCollection("GetDoc", "app");
      const doc = await docService.insert("GetDoc", { title: "Readable", amount: 42.5 }, adminUser);
      insertedId = doc._id;
    });

    it("retrieves a previously inserted document", async () => {
      const doc = await docService.getDoc("GetDoc", insertedId, adminUser);

      expect(doc._id).toBe(insertedId);
      expect(doc._data["title"]).toBe("Readable");
      expect(doc._data["amount"]).toBeCloseTo(42.5);
    });

    it("throws NotFoundError for a non-existent name", async () => {
      await expect(docService.getDoc("GetDoc", "non-existent-id", adminUser))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ── UPDATE ────────────────────────────────────────────────

  describe("update", () => {
    let insertedId: string;

    beforeEach(async () => {
      const entity = makeEntity({ name: "UpdateDoc" });
      registry.register(entity);
      await db.ensureCollection("UpdateDoc", "app");
      const doc = await docService.insert("UpdateDoc", { title: "Original" }, adminUser);
      insertedId = doc._id;
    });

    it("updates fields and persists changes", async () => {
      await docService.update("UpdateDoc", insertedId, { title: "Modified" }, adminUser);

      const doc = await docService.getDoc("UpdateDoc", insertedId, adminUser);
      expect(doc._data["title"]).toBe("Modified");
    });

    it("updates modified_by and modified timestamp", async () => {
      const before = await docService.getDoc("UpdateDoc", insertedId, adminUser);
      const beforeModified = before.modified;

      await new Promise((r) => setTimeout(r, 50));

      await docService.update("UpdateDoc", insertedId, { title: "Changed" }, adminUser);
      const after = await docService.getDoc("UpdateDoc", insertedId, adminUser);

      expect(after.modified.getTime()).toBeGreaterThanOrEqual(beforeModified.getTime());
      expect(after.modified_by).toBe("admin@test.local");
    });

    it("throws NotFoundError when updating non-existent document", async () => {
      await expect(docService.update("UpdateDoc", "no-such-doc", { title: "X" }, adminUser))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ── DELETE ────────────────────────────────────────────────

  describe("deleteDoc", () => {
    beforeEach(async () => {
      const entity = makeEntity({ name: "DeleteDoc" });
      registry.register(entity);
      await db.ensureCollection("DeleteDoc", "app");
    });

    it("removes a document from the database", async () => {
      const doc = await docService.insert("DeleteDoc", { title: "To Delete" }, adminUser);
      await docService.deleteDoc("DeleteDoc", doc._id, adminUser);

      await expect(docService.getDoc("DeleteDoc", doc._id, adminUser))
        .rejects.toThrow(NotFoundError);
    });

    it("throws NotFoundError when deleting non-existent document", async () => {
      await expect(docService.deleteDoc("DeleteDoc", "ghost", adminUser))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ── EXISTS / COUNT ────────────────────────────────────────

  describe("exists and count", () => {
    beforeEach(async () => {
      const entity = makeEntity({ name: "ExistsDoc" });
      registry.register(entity);
      await db.ensureCollection("ExistsDoc", "app");
    });

    it("exists returns true for an existing document", async () => {
      const doc = await docService.insert("ExistsDoc", { title: "Here" }, adminUser);
      const exists = await docService.exists("ExistsDoc", doc._id);
      expect(exists).toBe(true);
    });

    it("exists returns false for a non-existent document", async () => {
      const exists = await docService.exists("ExistsDoc", "nope");
      expect(exists).toBe(false);
    });

    it("count returns the number of documents", async () => {
      await docService.insert("ExistsDoc", { title: "One" }, adminUser);
      await docService.insert("ExistsDoc", { title: "Two" }, adminUser);

      // count now enforces `select` like getList (P-SEC) — pass the caller.
      const count = await docService.count("ExistsDoc", [], adminUser);
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  // ── LINK VALIDATION ──────────────────────────────────────

  describe("link validation on insert", () => {
    beforeEach(async () => {
      const targetEntity = makeEntity({
        name: "Customer",
        naming: { strategy: "user_set" },
        fields: [
          { fieldname: "name", fieldtype: "Data" as const, label: "Name", required: true },
        ],
      });
      registry.register(targetEntity);
      await db.ensureCollection("Customer", "app");

      const linkEntity = makeEntity({
        name: "Invoice",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title", required: true },
          { fieldname: "customer", fieldtype: "Link" as const, label: "Customer", target: "Customer" },
        ],
      });
      registry.register(linkEntity);
      await db.ensureCollection("Invoice", "app");
    });

    it("allows insert when linked document exists", async () => {
      await docService.insert("Customer", { _id: "CUST-001", name: "Acme" }, adminUser);

      const doc = await docService.insert("Invoice", { title: "INV 1", customer: "CUST-001" }, adminUser);
      expect(doc._data["customer"]).toBe("CUST-001");
    });

    it("rejects insert when linked document does not exist", async () => {
      await expect(
        docService.insert("Invoice", { title: "INV 2", customer: "GHOST-CUST" }, adminUser),
      ).rejects.toThrow(/Validation failed/);
    });
  });

  // ── DELETE PROTECTION ────────────────────────────────────

  describe("delete protection", () => {
    beforeEach(async () => {
      const parentEntity = makeEntity({
        name: "Department",
        naming: { strategy: "user_set" },
        fields: [
          { fieldname: "dept_name", fieldtype: "Data" as const, label: "Department Name", required: true },
        ],
      });
      registry.register(parentEntity);
      await db.ensureCollection("Department", "app");

      const childEntity = makeEntity({
        name: "Employee",
        fields: [
          { fieldname: "emp_name", fieldtype: "Data" as const, label: "Employee Name", required: true },
          { fieldname: "department", fieldtype: "Link" as const, label: "Department", target: "Department" },
        ],
      });
      registry.register(childEntity);
      await db.ensureCollection("Employee", "app");
    });

    it("blocks deletion when other documents reference the target", async () => {
      await docService.insert("Department", { _id: "DEPT-ENG", dept_name: "Engineering" }, adminUser);
      await docService.insert("Employee", { emp_name: "Alice", department: "DEPT-ENG" }, adminUser);

      await expect(docService.deleteDoc("Department", "DEPT-ENG", adminUser))
        .rejects.toThrow(DeleteBlockedError);
    });

    it("allows deletion when no references exist", async () => {
      await docService.insert("Department", { _id: "DEPT-EMPTY", dept_name: "Empty Dept" }, adminUser);

      await expect(docService.deleteDoc("Department", "DEPT-EMPTY", adminUser))
        .resolves.toBeUndefined();
    });
  });

  // ── FULL LIFECYCLE ───────────────────────────────────────

  describe("full document lifecycle", () => {
    beforeEach(async () => {
      const entity = makeEntity({ name: "LifecycleDoc" });
      registry.register(entity);
      await db.ensureCollection("LifecycleDoc", "app");
    });

    it("insert -> read -> update -> read -> delete -> not found", async () => {
      // Insert
      const created = await docService.insert("LifecycleDoc", { title: "Lifecycle Test", amount: 100 }, adminUser);
      expect(created._id).toBeTruthy();

      // Read
      const read1 = await docService.getDoc("LifecycleDoc", created._id, adminUser);
      expect(read1._data["title"]).toBe("Lifecycle Test");
      expect(read1._data["amount"]).toBe(100);

      // Update
      await docService.update("LifecycleDoc", created._id, { title: "Updated Title", amount: 200 }, adminUser);

      // Read again
      const read2 = await docService.getDoc("LifecycleDoc", created._id, adminUser);
      expect(read2._data["title"]).toBe("Updated Title");
      expect(read2._data["amount"]).toBe(200);

      // Delete
      await docService.deleteDoc("LifecycleDoc", created._id, adminUser);

      // Verify not found
      await expect(docService.getDoc("LifecycleDoc", created._id, adminUser))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ── getList ──────────────────────────────────────────────

  describe("getList", () => {
    beforeEach(async () => {
      const entity = makeEntity({ name: "ListDoc" });
      registry.register(entity);
      await db.ensureCollection("ListDoc", "app");
    });

    it("returns paginated results with total", async () => {
      await docService.insert("ListDoc", { title: "List A" }, adminUser);
      await docService.insert("ListDoc", { title: "List B" }, adminUser);
      await docService.insert("ListDoc", { title: "List C" }, adminUser);

      const result = await docService.getList("ListDoc", { page: 1, page_size: 2 }, adminUser);

      expect(result.data.length).toBe(2);
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.page_size).toBe(2);
      expect(result.total_pages).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("DocShare read access (D10b)", () => {
  const viewer: UserContext = {
    _id: "viewer-001",
    email: "viewer@test.local",
    roles: ["Viewer"], // a role with NO permission on SharedDoc
    full_name: "Viewer",
  };
  let shareService: DocumentShareService;

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "SharedDoc",
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
        ],
      }),
    );
    await db.ensureCollection("SharedDoc", "app");
    // List entity: Viewer may select/read but only OWN docs (if_owner).
    registry.register(
      makeEntity({
        name: "SharedListDoc",
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "Viewer", level: 0, select: 1, read: 1, if_owner: true },
        ],
      }),
    );
    await db.ensureCollection("SharedListDoc", "app");
    await db.ensureCollection(DIGITA.COLLECTIONS.DOC_SHARE, DIGITA.DATABASES.IDENTITY);
    shareService = new DocumentShareService(db);
  });

  it("denies a user without read role, but an explicit DocShare grants read", async () => {
    const doc = await docService.insert("SharedDoc", { title: "Secret" }, adminUser);

    // No read permission for Viewer → denied.
    await expect(docService.getDoc("SharedDoc", doc._id, viewer)).rejects.toThrow(PermissionDeniedError);

    // Share the document with the viewer (read).
    await shareService.share({
      entity: "SharedDoc",
      document_name: doc._id,
      shared_with: viewer.email,
      shared_by: adminUser.email,
      can_read: true,
      can_write: false,
      can_share: false,
      notify: false,
    });

    // Now the viewer can read exactly this document.
    const seen = await docService.getDoc("SharedDoc", doc._id, viewer);
    expect(seen._id).toBe(doc._id);

    // Revoking the share denies access again.
    await shareService.unshare("SharedDoc", doc._id, viewer.email);
    await expect(docService.getDoc("SharedDoc", doc._id, viewer)).rejects.toThrow(PermissionDeniedError);
  });

  it("surfaces shared documents in list views (beyond the user's scope)", async () => {
    const doc = await docService.insert("SharedListDoc", { title: "Listed" }, adminUser);

    // Viewer (if_owner) owns nothing here → the doc is NOT in their list.
    const before = await docService.getList("SharedListDoc", {}, viewer);
    expect(before.data.some((d) => (d as { _id: string })._id === doc._id)).toBe(false);

    // Share it → now it appears in the viewer's list.
    await shareService.share({
      entity: "SharedListDoc",
      document_name: doc._id,
      shared_with: viewer.email,
      shared_by: adminUser.email,
      can_read: true,
      can_write: false,
      can_share: false,
      notify: false,
    });
    const after = await docService.getList("SharedListDoc", {}, viewer);
    expect(after.data.some((d) => (d as { _id: string })._id === doc._id)).toBe(true);
  });
});

describe("Write-field-level permissions (perm_level)", () => {
  // Clerk has write at level 0 only → cannot write the level-1 "secret" field.
  const clerk: UserContext = {
    _id: "clerk-001",
    email: "clerk@test.local",
    roles: ["Clerk"],
    full_name: "Clerk",
  };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "WriteGated",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          { fieldname: "secret", fieldtype: "Data" as const, label: "Secret", perm_level: 1 },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "Clerk", level: 0, select: 1, read: 1, write: 1, create: 1 },
        ],
      }),
    );
    await db.ensureCollection("WriteGated", "app");
  });

  it("strips a protected field a user may not write on INSERT", async () => {
    const doc = await docService.insert("WriteGated", { title: "T", secret: "leaked" }, clerk);
    // Admin reads the raw doc — secret must NOT have been written by the clerk.
    const raw = await docService.getDoc("WriteGated", doc._id, adminUser);
    expect(raw.get("title")).toBe("T");
    expect(raw.get("secret")).toBeUndefined();
  });

  it("strips a protected field a user may not write on UPDATE", async () => {
    const doc = await docService.insert("WriteGated", { title: "T2" }, adminUser);
    await docService.update("WriteGated", doc._id, { title: "T2-edited", secret: "hacked" }, clerk);
    const raw = await docService.getDoc("WriteGated", doc._id, adminUser);
    expect(raw.get("title")).toBe("T2-edited"); // allowed field went through
    expect(raw.get("secret")).toBeUndefined(); // protected field was stripped
  });

  it("Administrator (unrestricted) can write the protected field", async () => {
    const doc = await docService.insert("WriteGated", { title: "A", secret: "ok" }, adminUser);
    const raw = await docService.getDoc("WriteGated", doc._id, adminUser);
    expect(raw.get("secret")).toBe("ok");
  });
});

describe("Available actions (ActionRunner)", () => {
  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "Actionable",
        fields: [{ fieldname: "status", fieldtype: "Data" as const, label: "Status" }],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
        ],
        actions: [
          { label: "Approve", action: "approve", show_if: "doc.status == 'Draft'" },
          { label: "Always", action: "always" },
        ],
      }),
    );
    await db.ensureCollection("Actionable", "app");
  });

  it("returns actions whose show_if matches the doc", async () => {
    const doc = await docService.insert("Actionable", { status: "Draft" }, adminUser);
    const actions = await docService.getAvailableActions("Actionable", doc._id, adminUser);
    const labels = actions.map((a) => a.action);
    expect(labels).toContain("approve");
    expect(labels).toContain("always");
  });

  it("hides actions whose show_if does not match the doc", async () => {
    const doc = await docService.insert("Actionable", { status: "Done" }, adminUser);
    const actions = await docService.getAvailableActions("Actionable", doc._id, adminUser);
    const labels = actions.map((a) => a.action);
    expect(labels).not.toContain("approve");
    expect(labels).toContain("always");
  });
});

// ── C1: enumeration paths honor a per-doc read `condition` ──────────────────
// A role granted read with a `condition` (the documented `eval:` pattern) must
// not see rows the condition hides — via list/count/exists, not only getDoc.
describe("C1 — condition enforced on list/count/exists", () => {
  const reader: UserContext = {
    _id: "reader-001",
    email: "reader@test.local",
    roles: ["CondReader"],
    full_name: "Cond Reader",
  };

  beforeAll(async () => {
    const entity = makeEntity({
      name: "CondDoc",
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "CondReader", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, condition: "eval:doc.status=='Active'" },
      ],
    });
    registry.register(entity);
    await db.ensureCollection("CondDoc", "app");
    const now = new Date();
    const base = { doctype: "CondDoc", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now };
    await db.insertOne("CondDoc", { ...base, _id: "CD-active", title: "A", status: "Active" }, "app");
    await db.insertOne("CondDoc", { ...base, _id: "CD-draft", title: "B", status: "Draft" }, "app");
  });

  it("getList returns only condition-visible rows for a conditional reader", async () => {
    const res = await docService.getList("CondDoc", {}, reader);
    const ids = res.data.map((r) => r["_id"]);
    expect(ids).toContain("CD-active");
    expect(ids).not.toContain("CD-draft");
  });

  it("getList is unrestricted for Administrator", async () => {
    const res = await docService.getList("CondDoc", {}, adminUser);
    const ids = res.data.map((r) => r["_id"]);
    expect(ids).toEqual(expect.arrayContaining(["CD-active", "CD-draft"]));
  });

  it("count counts only condition-visible rows", async () => {
    expect(await docService.count("CondDoc", [], reader)).toBe(1);
    expect(await docService.count("CondDoc", [], adminUser)).toBe(2);
  });

  it("exists is false for a condition-hidden row, true for a visible one", async () => {
    expect(await docService.exists("CondDoc", "CD-draft", reader)).toBe(false);
    expect(await docService.exists("CondDoc", "CD-active", reader)).toBe(true);
  });
});

// H7: submit()/cancel() loaded the doc and gated on docstatus OUTSIDE the
// transaction, and the write was an unconditional updateOne by _id — so a
// concurrent (or retried) submit/cancel re-ran on_submit/on_cancel and
// double-posted. Each now re-validates the committed state under the session.
describe("H7 — submit/cancel idempotency", () => {
  beforeAll(async () => {
    registry.register(makeEntity({ name: "SubDoc", is_submittable: true }));
    await db.ensureCollection("SubDoc", "app");
  });

  it("rejects a second submit of an already-submitted doc", async () => {
    const doc = await docService.insert("SubDoc", { title: "T" }, adminUser);
    await docService.submit("SubDoc", doc._id, adminUser);
    await expect(docService.submit("SubDoc", doc._id, adminUser)).rejects.toBeDefined();
  });

  it("concurrent double-submit resolves to exactly one success", async () => {
    const doc = await docService.insert("SubDoc", { title: "C" }, adminUser);
    const results = await Promise.allSettled([
      docService.submit("SubDoc", doc._id, adminUser),
      docService.submit("SubDoc", doc._id, adminUser),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const raw = (await db.findOne("SubDoc", doc._id, "app")) as Record<string, unknown>;
    expect(raw["docstatus"]).toBe(1);
  });

  it("rejects a second cancel of an already-cancelled doc", async () => {
    const doc = await docService.insert("SubDoc", { title: "X" }, adminUser);
    await docService.submit("SubDoc", doc._id, adminUser);
    await docService.cancel("SubDoc", doc._id, adminUser);
    await expect(docService.cancel("SubDoc", doc._id, adminUser)).rejects.toBeDefined();
  });

  it("re-runs the forward-immutability check INSIDE the cancel transaction", async () => {
    // Defense-in-depth: cancelProtection.check must be invoked with an in-tx
    // session (not only in the pre-transaction fast-fail).
    const spy = vi.spyOn(cancelProtection, "check");
    try {
      const doc = await docService.insert("SubDoc", { title: "TX" }, adminUser);
      await docService.submit("SubDoc", doc._id, adminUser);
      await docService.cancel("SubDoc", doc._id, adminUser);
      // The pre-transaction fast-fail calls check(doctype, name) with NO 3rd arg;
      // the in-tx re-check passes the transaction session. Assert some call
      // received a ClientSession as its 3rd arg (checking inTransaction() after
      // the fact would be false — the tx has already committed by then).
      const withSession = spy.mock.calls.some((c) => {
        const s = c[2] as { inTransaction?: () => boolean } | undefined;
        return !!s && typeof s.inTransaction === "function";
      });
      expect(withSession).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Rating field — out-of-range input is rejected, not silently clamped", () => {
  const ratingEntity = makeEntity({
    name: "RatingDoc",
    fields: [
      { fieldname: "title", fieldtype: "Data" as const, label: "Title", required: true },
      { fieldname: "score", fieldtype: "Rating" as const, label: "Score" },
    ],
  });

  beforeEach(async () => {
    registry.register(ratingEntity);
    await db.ensureCollection("RatingDoc", "app");
  });

  it("accepts an in-range [0,1] rating and stores it unchanged", async () => {
    const doc = await docService.insert("RatingDoc", { title: "ok", score: 0.8 }, adminUser);
    const raw = (await db.findOne("RatingDoc", doc._id, "app")) as Record<string, unknown>;
    expect(raw["score"]).toBe(0.8);
  });

  it("rejects an out-of-range rating (5) instead of clamping it to 1", async () => {
    // Before the fix, serialize clamped 5→1 BEFORE Zod, so the write silently
    // succeeded with a corrupted value. Now it must fail validation.
    await expect(
      docService.insert("RatingDoc", { title: "bad", score: 5 }, adminUser),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });
});

describe("copyDoc clones File attachments (no shared File doc)", () => {
  const attachEntity = makeEntity({
    name: "AttachDoc",
    fields: [
      { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
      { fieldname: "doc", fieldtype: "Attach" as const, label: "Doc" },
    ],
  });

  beforeEach(async () => {
    registry.register(attachEntity);
    await db.ensureCollection("AttachDoc", "app");
    await db.ensureCollection(DIGITA.COLLECTIONS.FILE, "core");
  });

  it("gives the copy its OWN File doc sharing the same blob", async () => {
    // Seed a source File doc + a doc referencing it by URL.
    await db.insertOne(
      DIGITA.COLLECTIONS.FILE,
      {
        _id: "FILE-000900",
        doctype: "file",
        docstatus: 0,
        is_private: true,
        file_name: "a.pdf",
        file_url: "/api/v1/file/FILE-000900/download",
        storage_key: "customers/shared-blob.pdf",
        storage_backend: "local",
        owner: adminUser.email,
      },
      "core",
    );
    const src = await docService.insert(
      "AttachDoc",
      { title: "src", doc: "/api/v1/file/FILE-000900/download" },
      adminUser,
    );

    const copy = await docService.copyDoc("AttachDoc", src._id, adminUser);
    const copyUrl = copy.get("doc") as string;
    const copyFileId = copyUrl.match(/\/file\/([^/]+)\/download/)?.[1];

    // Copy points at a DIFFERENT File doc…
    expect(copyFileId).toBeDefined();
    expect(copyFileId).not.toBe("FILE-000900");
    // …that shares the same underlying blob (storage_key).
    const cloneFile = (await db.findOne(DIGITA.COLLECTIONS.FILE, copyFileId!, "core")) as Record<string, unknown>;
    expect(cloneFile["storage_key"]).toBe("customers/shared-blob.pdf");
    expect(cloneFile["owner"]).toBe(adminUser.email);
    // Source File doc untouched.
    const srcFile = (await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-000900", "core")) as Record<string, unknown>;
    expect(srcFile["storage_key"]).toBe("customers/shared-blob.pdf");
  });
});

describe("Child-row defaults on the UPDATE path (parity with insert)", () => {
  const defEntity = makeEntity({
    name: "DefDoc",
    fields: [
      { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
      {
        fieldname: "lines",
        fieldtype: "Table" as const,
        label: "Lines",
        child_fields: [
          { fieldname: "product", fieldtype: "Data" as const, label: "Product" },
          { fieldname: "line_date", fieldtype: "Date" as const, label: "Line Date", default: "__today__" },
          { fieldname: "added_by", fieldtype: "Data" as const, label: "Added By", default: "__user__" },
        ],
      },
    ],
  });

  beforeEach(async () => {
    registry.register(defEntity);
    await db.ensureCollection("DefDoc", "app");
  });

  it("applies child defaults to a row ADDED during update, leaving existing rows untouched", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await docService.insert("DefDoc", { title: "T", lines: [{ product: "P-1" }] }, adminUser);
    const raw0 = (await db.findOne("DefDoc", created._id, "app")) as Record<string, unknown>;
    const existingRow = (raw0["lines"] as Record<string, unknown>[])[0]!;
    const existingDate = existingRow["line_date"];

    // Update: keep the existing row (with its _row_id) + add a brand-new row.
    await docService.update(
      "DefDoc",
      created._id,
      { title: "T", lines: [existingRow, { product: "P-2" }] },
      adminUser,
    );

    const raw1 = (await db.findOne("DefDoc", created._id, "app")) as Record<string, unknown>;
    const rows = raw1["lines"] as Record<string, unknown>[];
    const newRow = rows.find((r) => r["product"] === "P-2")!;
    // NEW row got the defaults expanded.
    expect(String(newRow["line_date"]).slice(0, 10)).toBe(today);
    expect(newRow["added_by"]).toBe(adminUser.email);
    // EXISTING row unchanged.
    const keptRow = rows.find((r) => r["product"] === "P-1")!;
    expect(keptRow["line_date"]).toEqual(existingDate);
  });
});

describe("runAction — a long_running action with no handler fails loud (A2)", () => {
  const actEntity = makeEntity({
    name: "ActDoc",
    actions: [{ action: "sync", label: "Sync", long_running: true }],
  } as Partial<EntityDefinition>);

  beforeEach(async () => {
    registry.register(actEntity);
    await db.ensureCollection("ActDoc", "app");
  });

  it("throws ActionHandlerMissingError for a handler-less long_running action", async () => {
    const doc = await docService.insert("ActDoc", { title: "x" }, adminUser);
    await expect(
      docService.runAction("ActDoc", doc._id, "sync", adminUser),
    ).rejects.toBeInstanceOf(ActionHandlerMissingError);
  });
});

describe("update — workflow side_effects.set persist to the DB (E3 latent-bug regression)", () => {
  const wfEntity = makeEntity({
    name: "WfDoc",
    workflow_field: "status",
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["Draft", "Active"], default: "Draft" },
      { fieldname: "activated_flag", fieldtype: "Data", label: "Activated flag" },
    ],
    states: [
      { value: "Draft", is_initial: true },
      { value: "Active" },
    ],
    transitions: [
      { from: "Draft", to: "Active", action: "activate", side_effects: { set: { activated_flag: "YES" } } },
    ],
  } as unknown as Partial<EntityDefinition>);

  beforeEach(async () => {
    registry.register(wfEntity);
    await db.ensureCollection("WfDoc", "app");
  });

  it("persists the transition's side_effects.set to the DB row, not just the workflow field", async () => {
    const doc = await docService.insert("WfDoc", { title: "x", status: "Draft" }, adminUser);
    await docService.update("WfDoc", doc._id, { status: "Active" }, adminUser);

    // Re-read the RAW db row — NOT the returned doc — so this proves the write
    // actually landed. On the pre-fix code applyTransition mutated doc._data
    // directly, the field never entered _dirty, and getChanges() dropped it:
    // activated_flag would be undefined here (RED).
    const raw = await db.findOne("WfDoc", doc._id, "app");
    expect(raw?.["status"]).toBe("Active");
    expect(raw?.["activated_flag"]).toBe("YES");
  });
});
