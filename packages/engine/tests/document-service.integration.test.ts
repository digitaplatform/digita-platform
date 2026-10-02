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
import { FilterFieldNotAllowedError } from "../src/core/database/filter-builder.js";
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
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db), permissionChecker);
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);
  const workflowEngine = new WorkflowEngine();

  docService = new DocumentService({
    tenantTimeZone: () => "UTC",
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

describe("A save keeps the stored value of a child field the user may not write", () => {
  // Technician writes level 0 only: `step` is read_only, `note` is on level 1.
  const technician: UserContext = { _id: "tech-001", email: "tech@test.local", roles: ["Technician"], full_name: "Tech" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "ChecklistDoc",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          {
            fieldname: "checklist",
            fieldtype: "Table" as const,
            label: "Checklist",
            child_fields: [
              { fieldname: "step", fieldtype: "Data" as const, label: "Step", read_only: true, default: "Extra step" },
              { fieldname: "done", fieldtype: "Check" as const, label: "Done" },
              { fieldname: "note", fieldtype: "Data" as const, label: "Note", perm_level: 1 },
            ],
          },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "Technician", level: 0, select: 1, read: 1, write: 1 },
        ],
      }),
    );
    await db.ensureCollection("ChecklistDoc", "app");
  });

  async function storedRows(name: string): Promise<Record<string, unknown>[]> {
    const raw = (await db.findOne("ChecklistDoc", name, "app")) as Record<string, unknown>;
    return raw["checklist"] as Record<string, unknown>[];
  }

  it("keeps a gated child field on every existing row and defaults it on a new row", async () => {
    const created = await docService.insert(
      "ChecklistDoc",
      { title: "WO", checklist: [{ step: "Brakes", note: "pads worn" }, { step: "Chain", note: "stretched" }] },
      adminUser,
    );
    const [brakes, chain] = await storedRows(created._id);

    // The technician resends the rows as read (no `note`), tries to rename one
    // step, and adds a row.
    await docService.update(
      "ChecklistDoc",
      created._id,
      {
        checklist: [
          { _row_id: brakes!["_row_id"], step: "Brakes", done: true },
          { _row_id: chain!["_row_id"], step: "Renamed", done: true },
          { step: "Forged", done: false },
        ],
      },
      technician,
    );

    const rows = await storedRows(created._id);
    expect(rows.map((r) => r["step"])).toEqual(["Brakes", "Chain", "Extra step"]);
    expect(rows.map((r) => r["note"])).toEqual(["pads worn", "stretched", undefined]);
    expect(rows.map((r) => r["done"])).toEqual([true, true, false]);
  });

  it("lets Administrator change the gated child field", async () => {
    const created = await docService.insert("ChecklistDoc", { title: "WO", checklist: [{ step: "Brakes" }] }, adminUser);
    const [brakes] = await storedRows(created._id);

    await docService.update(
      "ChecklistDoc",
      created._id,
      { checklist: [{ _row_id: brakes!["_row_id"], step: "Brakes and pads", note: "checked" }] },
      adminUser,
    );

    const [row] = await storedRows(created._id);
    expect(row!["step"]).toBe("Brakes and pads");
    expect(row!["note"]).toBe("checked");
  });
});

describe("A Table write that repeats a _row_id is refused", () => {
  // Technician writes level 0 only: `note` is on level 1, so a save keeps it from the stored row.
  const technician: UserContext = { _id: "tech-002", email: "tech2@test.local", roles: ["Technician"], full_name: "Tech" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "RowIdDoc",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          {
            fieldname: "checklist",
            fieldtype: "Table" as const,
            label: "Checklist",
            child_fields: [
              { fieldname: "done", fieldtype: "Check" as const, label: "Done" },
              { fieldname: "note", fieldtype: "Data" as const, label: "Note", perm_level: 1 },
            ],
          },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "Technician", level: 0, select: 1, read: 1, write: 1 },
        ],
      }),
    );
    await db.ensureCollection("RowIdDoc", "app");
  });

  async function storedRows(name: string): Promise<Record<string, unknown>[]> {
    const raw = (await db.findOne("RowIdDoc", name, "app")) as Record<string, unknown>;
    return raw["checklist"] as Record<string, unknown>[];
  }

  async function refusal(write: Promise<unknown>): Promise<ValidationFailedError> {
    const err = await write.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationFailedError);
    return err as ValidationFailedError;
  }

  it("refuses an update that repeats a stored row's _row_id and stores nothing", async () => {
    const created = await docService.insert("RowIdDoc", { title: "WO", checklist: [{ note: "approved" }] }, adminUser);
    const [stored] = await storedRows(created._id);
    const rowId = stored!["_row_id"];

    const err = await refusal(
      docService.update(
        "RowIdDoc",
        created._id,
        { checklist: [{ _row_id: rowId, done: true }, { _row_id: rowId, done: false }] },
        technician,
      ),
    );
    expect(err.errors).toEqual([
      expect.objectContaining({ field: "checklist[1]", message_key: "table_row_unique_violation" }),
    ]);
    expect(await storedRows(created._id)).toEqual([stored]);
  });

  it("refuses the repeat from Administrator and on insert", async () => {
    const created = await docService.insert("RowIdDoc", { title: "WO", checklist: [{ note: "one" }] }, adminUser);
    const [stored] = await storedRows(created._id);
    await refusal(
      docService.update(
        "RowIdDoc",
        created._id,
        { checklist: [{ ...stored }, { ...stored, note: "two" }] },
        adminUser,
      ),
    );
    await refusal(
      docService.insert("RowIdDoc", { title: "WO", checklist: [{ _row_id: "R1" }, { _row_id: "R1" }] }, adminUser),
    );
  });

  it("stores rows with distinct ids and new rows without one", async () => {
    const created = await docService.insert("RowIdDoc", { title: "WO", checklist: [{ note: "one" }] }, adminUser);
    const [stored] = await storedRows(created._id);

    await docService.update(
      "RowIdDoc",
      created._id,
      { checklist: [{ ...stored, done: true }, { done: false }, { done: false }] },
      technician,
    );

    const rows = await storedRows(created._id);
    expect(rows.map((r) => r["note"])).toEqual(["one", undefined, undefined]);
    expect(new Set(rows.map((r) => r["_row_id"])).size).toBe(3);
  });
});

describe("An update re-derives the fetch_from fields of a row whose Link changed", () => {
  // SalesOrder.lines in small: `product_code` is read_only, `uom` is writable,
  // both fetch_from the row's `product` with fetch_if_empty.
  const salesperson: UserContext = { _id: "sp-001", email: "sp@test.local", roles: ["Salesperson"], full_name: "Sales" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "FetchProduct",
        naming: { strategy: "user_set" },
        fields: [
          { fieldname: "product_no", fieldtype: "Data" as const, label: "Product No" },
          { fieldname: "sales_uom", fieldtype: "Data" as const, label: "Sales UOM" },
        ],
      }),
    );
    registry.register(
      makeEntity({
        name: "FetchOrder",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          {
            fieldname: "lines",
            fieldtype: "Table" as const,
            label: "Lines",
            child_fields: [
              { fieldname: "product", fieldtype: "Link" as const, label: "Product", target: "FetchProduct" },
              {
                fieldname: "product_code",
                fieldtype: "Data" as const,
                label: "Product Code",
                read_only: true,
                fetch_from: "product.product_no",
                fetch_if_empty: true,
              },
              { fieldname: "uom", fieldtype: "Data" as const, label: "UOM", fetch_from: "product.sales_uom", fetch_if_empty: true },
              { fieldname: "quantity", fieldtype: "Float" as const, label: "Quantity" },
            ],
          },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "Salesperson", level: 0, select: 1, read: 1, write: 1, create: 1 },
          { role: "Picker", level: 0, select: 1 },
        ],
      }),
    );
    await db.ensureCollection("FetchProduct", "app");
    await db.ensureCollection("FetchOrder", "app");
    await docService.insert("FetchProduct", { _id: "SERVICE", product_no: "S-100", sales_uom: "HOUR" }, adminUser);
    await docService.insert("FetchProduct", { _id: "STOCKABLE", product_no: "P-200", sales_uom: "PCS" }, adminUser);
    await docService.insert("FetchProduct", { _id: "PLAIN" }, adminUser);
  });

  async function storedLines(name: string): Promise<Record<string, unknown>[]> {
    const raw = (await db.findOne("FetchOrder", name, "app")) as Record<string, unknown>;
    return raw["lines"] as Record<string, unknown>[];
  }

  it("re-derives the changed row, adds a new row's values, and leaves an unchanged row alone", async () => {
    const created = await docService.insert(
      "FetchOrder",
      { title: "SO", lines: [{ product: "SERVICE", quantity: 1 }, { product: "SERVICE", quantity: 2 }] },
      salesperson,
    );
    const [changed, unchanged] = await storedLines(created._id);
    expect(changed!["product_code"]).toBe("S-100");
    // A later edit of the product must not reach a row whose product stays.
    await db.updateOne("FetchProduct", "SERVICE", { product_no: "S-101" }, "app");

    // The salesperson resends the rows as read and points the first at another product.
    await docService.update(
      "FetchOrder",
      created._id,
      {
        lines: [
          { ...changed, product: "STOCKABLE" },
          { ...unchanged },
          { product: "STOCKABLE", quantity: 3 },
        ],
      },
      salesperson,
    );

    const rows = await storedLines(created._id);
    expect(rows.map((r) => r["product_code"])).toEqual(["P-200", "S-100", "P-200"]);
    expect(rows.map((r) => r["uom"])).toEqual(["PCS", "HOUR", "PCS"]);
  });

  it("clears a fetched value when the row's new source has none, as an insert with it stores none", async () => {
    const created = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "STOCKABLE", quantity: 1 }] }, salesperson);
    const [row] = await storedLines(created._id);
    expect(row!["product_code"]).toBe("P-200");

    await docService.update("FetchOrder", created._id, { lines: [{ ...row, product: "PLAIN" }] }, salesperson);

    const [moved] = await storedLines(created._id);
    expect(moved!["product_code"] ?? null).toBeNull();
    expect(moved!["uom"] ?? null).toBeNull();
    const inserted = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "PLAIN" }] }, salesperson);
    const [fresh] = await storedLines(inserted._id);
    expect(fresh!["product_code"] ?? null).toBeNull();
  });

  it("clears the fetched values of a row whose Link is cleared, as an insert without one stores none", async () => {
    const created = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "STOCKABLE", quantity: 1 }] }, salesperson);
    const [row] = await storedLines(created._id);
    expect(row!["product_code"]).toBe("P-200");

    await docService.update("FetchOrder", created._id, { lines: [{ ...row, product: null }] }, salesperson);

    const [cleared] = await storedLines(created._id);
    expect(cleared!["product"] ?? null).toBeNull();
    expect(cleared!["product_code"] ?? null).toBeNull();
    expect(cleared!["uom"] ?? null).toBeNull();
  });

  it("previews a saved record's row whose Link changed with the values the save stores", async () => {
    const created = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "SERVICE", quantity: 1 }] }, salesperson);
    const [row] = await storedLines(created._id);
    expect(row!["uom"]).toBe("HOUR");
    const draft = { _id: created._id, title: "SO", lines: [{ ...row, product: "STOCKABLE" }] };

    const preview = await docService.preview("FetchOrder", draft, salesperson, undefined, created._id);
    await docService.update("FetchOrder", created._id, { lines: draft.lines }, salesperson);

    const [saved] = await storedLines(created._id);
    expect(saved!["uom"]).toBe("PCS");
    const [previewed] = preview._data["lines"] as Record<string, unknown>[];
    expect(previewed!["uom"]).toBe(saved!["uom"]);
    expect(previewed!["product_code"]).toBe(saved!["product_code"]);
  });

  it("refuses to preview a saved record to a role that may pick but not read it", async () => {
    const created = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "SERVICE" }] }, adminUser);
    const picker: UserContext = { _id: "pk-1", email: "pk@test.local", roles: ["Picker"], full_name: "Picker" };
    await expect(docService.preview("FetchOrder", { lines: [] }, picker, undefined, created._id)).rejects.toThrow();
  });

  it("previews the unchanged rows of a saved record with their stored read-only cells", async () => {
    const created = await docService.insert(
      "FetchOrder",
      { title: "SO", lines: [{ product: "SERVICE" }, { product: "STOCKABLE" }] },
      salesperson,
    );
    const rows = await storedLines(created._id);
    // product_code is read_only: the Salesperson's draft carries it as read, and may not write it.
    const preview = await docService.preview("FetchOrder", { title: "SO renamed", lines: rows }, salesperson, undefined, created._id);
    const previewed = preview._data["lines"] as Record<string, unknown>[];
    expect(rows.map((r) => r["product_code"]).every(Boolean)).toBe(true);
    expect(previewed.map((r) => r["product_code"])).toEqual(rows.map((r) => r["product_code"]));
  });

  it("previews a draft as a draft, whatever _id its body carries", async () => {
    const other = await docService.insert("FetchOrder", { title: "Other", lines: [{ product: "SERVICE" }] }, adminUser);
    const preview = await docService.preview("FetchOrder", { _id: other._id, title: "Typed", lines: [{ product: "STOCKABLE" }] }, salesperson);
    expect(preview._data["title"]).toBe("Typed");
    expect((preview._data["lines"] as Record<string, unknown>[])[0]!["uom"]).toBe("PCS");
  });

  it("keeps a value the same write sets on the row whose Link changed", async () => {
    const created = await docService.insert("FetchOrder", { title: "SO", lines: [{ product: "SERVICE" }] }, adminUser);
    const [row] = await storedLines(created._id);

    await docService.update(
      "FetchOrder",
      created._id,
      { lines: [{ ...row, product: "STOCKABLE", product_code: "CUSTOM-1", uom: "BOX" }] },
      adminUser,
    );

    const [stored] = await storedLines(created._id);
    expect(stored!["product_code"]).toBe("CUSTOM-1");
    expect(stored!["uom"]).toBe("BOX");
  });
});

describe("Read-field-level permissions: a link title or status color shows only with its field", () => {
  // Clerk reads level 0 only: the Link `customer` and the `status` sit at level 1.
  const clerk: UserContext = {
    _id: "clerk-002",
    email: "clerk2@test.local",
    roles: ["Clerk"],
    full_name: "Clerk",
  };
  let orderId: string;

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "ReadGatedCustomer",
        naming: { strategy: "user_set" },
        title_field: "company_name",
        fields: [{ fieldname: "company_name", fieldtype: "Data" as const, label: "Company" }],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          { role: "Clerk", level: 0, select: 1, read: 0, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
        ],
      }),
    );
    registry.register(
      makeEntity({
        name: "ReadGatedOrder",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          { fieldname: "buyer", fieldtype: "Link" as const, label: "Buyer", target: "ReadGatedCustomer" },
          { fieldname: "customer", fieldtype: "Link" as const, label: "Customer", target: "ReadGatedCustomer", perm_level: 1 },
          { fieldname: "status", fieldtype: "Select" as const, label: "Status", options: ["Open", "Closed"], perm_level: 1 },
        ],
        states: [
          { value: "Open", color: "blue" },
          { value: "Closed", color: "gray" },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 1, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          { role: "Clerk", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
        ],
      }),
    );
    await db.ensureCollection("ReadGatedCustomer", "app");
    await db.ensureCollection("ReadGatedOrder", "app");
    await docService.insert("ReadGatedCustomer", { _id: "C-ACME", company_name: "Acme GmbH" }, adminUser);
    await docService.insert("ReadGatedCustomer", { _id: "C-BETA", company_name: "Beta AG" }, adminUser);
    const order = await docService.insert(
      "ReadGatedOrder",
      { title: "O", buyer: "C-BETA", customer: "C-ACME", status: "Open" },
      adminUser,
    );
    orderId = order._id;
  });

  it("getDoc names the title and the color of readable fields only", async () => {
    const masked = (await docService.getDoc("ReadGatedOrder", orderId, clerk)).toJSON() as Record<string, unknown>;
    expect(masked).not.toHaveProperty("customer");
    expect(masked).not.toHaveProperty("status");
    expect(masked["_link_titles"]).toEqual({ buyer: "Beta AG" });
    expect(masked["_status_indicator"]).toBeUndefined();

    const whole = (await docService.getDoc("ReadGatedOrder", orderId, adminUser)).toJSON() as Record<string, unknown>;
    expect(whole["_link_titles"]).toEqual({ buyer: "Beta AG", customer: "Acme GmbH" });
    expect(whole["_status_indicator"]).toEqual({ color: "blue" });
  });

  it("every list path names the titles of readable Links only", async () => {
    for (const query of [{}, { fields: ["_id", "buyer", "customer"] }]) {
      for (const options of [{}, { everyRowNeedsRead: true }]) {
        const listed = await docService.getList("ReadGatedOrder", query, clerk, undefined, undefined, options);
        const row = listed.data.find((r) => r["_id"] === orderId);
        expect(row).not.toHaveProperty("customer");
        expect(row?.["_link_titles"]).toEqual({ buyer: "Beta AG" });
      }
    }
    const whole = await docService.getList("ReadGatedOrder", {}, adminUser);
    expect(whole.data.find((r) => r["_id"] === orderId)?.["_link_titles"]).toEqual({
      buyer: "Beta AG",
      customer: "Acme GmbH",
    });
  });
});

describe("A list filters, searches and sorts only on fields the reader may read on every row", () => {
  // Clerk reads level 0, and level 2 only where a condition holds: `note` (level 1)
  // is masked everywhere, `review` (level 2) on some rows, `items.cost` (level 1) too.
  const clerk: UserContext = { _id: "clerk-003", email: "clerk3@test.local", roles: ["Clerk"], full_name: "Clerk" };
  const clerkOnly = [
    { role: "Clerk", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
    { role: "Clerk", level: 2, select: 0, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, condition: "eval:doc.title != 'Alpha'" },
  ];

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "FilterGatedDoc",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          { fieldname: "note", fieldtype: "Data" as const, label: "Note", perm_level: 1 },
          { fieldname: "review", fieldtype: "Data" as const, label: "Review", perm_level: 2 },
          {
            fieldname: "items",
            fieldtype: "Table" as const,
            label: "Items",
            child_fields: [
              { fieldname: "item", fieldtype: "Data" as const, label: "Item" },
              { fieldname: "cost", fieldtype: "Currency" as const, label: "Cost", perm_level: 1 },
            ],
          },
        ],
        search_fields: ["title", "note"],
        default_sort: { field: "note", order: "asc" },
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          ...clerkOnly,
        ],
      } as Partial<EntityDefinition>),
    );
    await db.ensureCollection("FilterGatedDoc", "app");
    const row = { doctype: "FilterGatedDoc", docstatus: 0, owner: "system", modified_by: "system", creation: new Date() };
    await db.insertOne("FilterGatedDoc", { ...row, _id: "FG-1", title: "Alpha", note: "operator only", review: "r1", items: [{ item: "A", cost: 5 }], modified: new Date("2026-01-01") }, "app");
    await db.insertOne("FilterGatedDoc", { ...row, _id: "FG-2", title: "Beta", note: "zeta", review: "r2", items: [{ item: "B", cost: 9 }], modified: new Date("2026-02-01") }, "app");
  });

  const ids = async (query: Parameters<DocumentService["getList"]>[1], user: UserContext = clerk) =>
    (await docService.getList("FilterGatedDoc", query, user)).data.map((r) => r["_id"]);

  it("refuses a filter, an or_filter or a sort on a field masked on any row", async () => {
    for (const field of ["note", "review", "items.cost", "items"]) {
      await expect(ids({ filters: [[field, "=", "x"]] }), field).rejects.toBeInstanceOf(FilterFieldNotAllowedError);
      await expect(ids({ or_filters: [[field, "=", "x"]] }), field).rejects.toBeInstanceOf(FilterFieldNotAllowedError);
      await expect(ids({ order_by: `title asc, ${field} desc` }), field).rejects.toBeInstanceOf(FilterFieldNotAllowedError);
      await expect(docService.count("FilterGatedDoc", [{ [field]: "x" }], clerk), field).rejects.toBeInstanceOf(FilterFieldNotAllowedError);
    }
  });

  it("filters and sorts on the fields the reader may read on every row", async () => {
    expect(await ids({ filters: [["title", "=", "Alpha"]] })).toEqual(["FG-1"]);
    expect(await ids({ filters: [["items.item", "=", "B"]] })).toEqual(["FG-2"]);
    expect(await ids({ order_by: "title desc" })).toEqual(["FG-2", "FG-1"]);
    expect(await docService.count("FilterGatedDoc", [{ title: "Beta" }], clerk)).toBe(1);
    expect(await ids({ filters: [["note", "=", "operator only"]] }, adminUser)).toEqual(["FG-1"]);
  });

  it("searches only the readable search fields, and sorts by default on a readable field", async () => {
    expect(await ids({ search: "operator" })).toEqual([]);
    expect(await ids({ search: "alp" })).toEqual(["FG-1"]);
    expect(await ids({ search: "operator" }, adminUser)).toEqual(["FG-1"]);
    // The default sort names `note`: the clerk gets the engine's default, modified desc.
    expect(await ids({})).toEqual(["FG-2", "FG-1"]);
    expect(await ids({}, adminUser)).toEqual(["FG-1", "FG-2"]);
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

  it("refuses to run an action whose show_if does not match the doc", async () => {
    const doc = await docService.insert("Actionable", { status: "Done" }, adminUser);
    await expect(docService.runAction("Actionable", doc._id, "approve", adminUser)).rejects.toMatchObject({
      name: "ActionNotAvailableError",
      statusCode: 409,
      messageKey: "action_not_available",
      params: { action: "Approve" },
    });
  });

  it("runs an action whose show_if matches the doc", async () => {
    const doc = await docService.insert("Actionable", { status: "Draft" }, adminUser);
    await expect(docService.runAction("Actionable", doc._id, "approve", adminUser)).resolves.toBeUndefined();
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

// A read condition sees the row as getDoc reads it: a stored Datetime is a Date,
// the row a reader gets carries it as an ISO string.
describe("exists evaluates a read condition on the row getDoc reads", () => {
  const reader: UserContext = { _id: "due-reader", email: "due-reader@test.local", roles: ["DueReader"] };

  beforeAll(async () => {
    registry.register(makeEntity({
      name: "DueDoc",
      fields: [
        { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
        { fieldname: "due", fieldtype: "Datetime" as const, label: "Due" },
      ],
      permissions: [
        { role: "DueReader", level: 0, select: 1, read: 1, condition: "eval:doc.due >= '2026-01-01'" },
      ],
    } as Partial<EntityDefinition>));
    await db.ensureCollection("DueDoc", "app");
    const now = new Date();
    const base = { doctype: "DueDoc", docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now };
    await db.insertOne("DueDoc", { ...base, _id: "DD-2026", title: "A", due: new Date("2026-06-01T00:00:00Z") }, "app");
    await db.insertOne("DueDoc", { ...base, _id: "DD-2025", title: "B", due: new Date("2025-06-01T00:00:00Z") }, "app");
  });

  it("answers as getDoc does for a condition on a Datetime field", async () => {
    await expect(docService.getDoc("DueDoc", "DD-2026", reader)).resolves.toBeDefined();
    expect(await docService.exists("DueDoc", "DD-2026", reader)).toBe(true);
    await expect(docService.getDoc("DueDoc", "DD-2025", reader)).rejects.toThrow();
    expect(await docService.exists("DueDoc", "DD-2025", reader)).toBe(false);
  });
});

// #41: the read gate evaluates a `condition` on the stored row, so the caller's
// `fields` decide only what the answer carries. Gated on a projected row, a
// condition over a field the caller did not ask for denied every row (a sitemap
// came back empty), and one that negates granted the rows it should hide.
describe("C1 — the read gate sees the stored row, whatever fields name", () => {
  const reader: UserContext = { _id: "reader-002", email: "reader2@test.local", roles: ["CondReader"], full_name: "Cond Reader" };
  const lister: UserContext = { _id: "lister-001", email: "lister@test.local", roles: ["Lister"], full_name: "Lister" };

  beforeAll(async () => {
    const now = new Date();
    const base = { docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now };
    registry.register(makeEntity({
      name: "NegCondDoc",
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "CondReader", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, condition: "eval:doc.status != 'Draft'" },
      ],
    }));
    await db.ensureCollection("NegCondDoc", "app");
    await db.insertOne("NegCondDoc", { ...base, doctype: "NegCondDoc", _id: "NCD-active", title: "A", status: "Active" }, "app");
    await db.insertOne("NegCondDoc", { ...base, doctype: "NegCondDoc", _id: "NCD-draft", title: "B", status: "Draft" }, "app");

    registry.register(makeEntity({
      name: "ListOnlyDoc",
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "Lister", level: 0, select: 1, read: 0, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
      ],
    }));
    await db.ensureCollection("ListOnlyDoc", "app");
    await db.insertOne("ListOnlyDoc", { ...base, doctype: "ListOnlyDoc", _id: "LOD-1", title: "L", status: "Active" }, "app");
  });

  it("admits the rows a condition allows when fields omit the field it reads", async () => {
    const res = await docService.getList("CondDoc", { fields: ["_id", "title"] }, reader);
    expect(res.data.map((r) => r["_id"])).toEqual(["CD-active"]);
    expect(Object.keys(res.data[0]!).sort()).toEqual(["_id", "title"]);
    expect(res.total).toBe(1);
  });

  it("hides the rows a negating condition excludes when fields omit the field it reads", async () => {
    const res = await docService.getList("NegCondDoc", { fields: ["_id", "title"] }, reader);
    expect(res.data.map((r) => r["_id"])).toEqual(["NCD-active"]);
  });

  it("answers the same rows with the condition's field projected, and without a projection", async () => {
    const projected = await docService.getList("CondDoc", { fields: ["_id", "title", "status"] }, reader);
    const whole = await docService.getList("CondDoc", {}, reader);
    expect(projected.data.map((r) => r["_id"])).toEqual(["CD-active"]);
    expect(whole.data.map((r) => r["_id"])).toEqual(["CD-active"]);
  });

  it("masks a field whose level a negating condition decides on the stored row, whatever fields name", async () => {
    const base = makeEntity();
    registry.register(makeEntity({
      name: "LevelCondDoc",
      fields: [...base.fields, { fieldname: "secret", fieldtype: "Data" as const, label: "Secret", perm_level: 1 }],
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "L1Reader", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
        { role: "L1Reader", level: 1, select: 0, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, condition: "eval:doc.status != 'Draft'" },
      ],
    }));
    await db.ensureCollection("LevelCondDoc", "app");
    const now = new Date();
    const row = { docstatus: 0, owner: "system", modified_by: "system", creation: now, modified: now, doctype: "LevelCondDoc" };
    await db.insertOne("LevelCondDoc", { ...row, _id: "LCD-active", title: "A", status: "Active", secret: "s-active" }, "app");
    await db.insertOne("LevelCondDoc", { ...row, _id: "LCD-draft", title: "B", status: "Draft", secret: "s-draft" }, "app");
    const l1reader: UserContext = { _id: "l1-001", email: "l1@test.local", roles: ["L1Reader"], full_name: "Level One" };
    for (const query of [{ fields: ["_id", "secret"] }, {}]) {
      const res = await docService.getList("LevelCondDoc", query, l1reader);
      const byId = new Map(res.data.map((r) => [r["_id"], r]));
      expect(byId.get("LCD-draft")).not.toHaveProperty("secret");
      expect(byId.get("LCD-active")?.["secret"]).toBe("s-active");
    }

    // A condition above level 0 decides fields, never whether a row may be read,
    // so count and exists answer from the query without loading a row.
    const find = vi.spyOn(db, "find");
    const findOne = vi.spyOn(db, "findOne");
    try {
      expect(await docService.count("LevelCondDoc", [], l1reader)).toBe(2);
      expect(await docService.exists("LevelCondDoc", "LCD-draft", l1reader)).toBe(true);
      expect(find.mock.calls.filter(([name]) => name === "LevelCondDoc")).toEqual([]);
      expect(findOne.mock.calls.filter(([name]) => name === "LevelCondDoc")).toEqual([]);
    } finally {
      find.mockRestore();
      findOne.mockRestore();
    }

    // A role that may list but not read keeps listing its rows; the level-1
    // condition only masks the fields it decides.
    registry.register(makeEntity({
      name: "ListOnlyLevelDoc",
      fields: [...base.fields, { fieldname: "secret", fieldtype: "Data" as const, label: "Secret", perm_level: 1 }],
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "LevelLister", level: 0, select: 1, read: 0, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
        { role: "LevelLister", level: 1, select: 0, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, condition: "eval:doc.status != 'Draft'" },
      ],
    }));
    await db.ensureCollection("ListOnlyLevelDoc", "app");
    await db.insertOne("ListOnlyLevelDoc", { ...row, doctype: "ListOnlyLevelDoc", _id: "LOL-active", title: "A", status: "Active", secret: "s-a" }, "app");
    await db.insertOne("ListOnlyLevelDoc", { ...row, doctype: "ListOnlyLevelDoc", _id: "LOL-draft", title: "B", status: "Draft", secret: "s-d" }, "app");
    const lister: UserContext = { _id: "ll-001", email: "ll@test.local", roles: ["LevelLister"], full_name: "Level Lister" };
    const listed = await docService.getList("ListOnlyLevelDoc", { fields: ["_id", "secret"] }, lister);
    const byId = new Map(listed.data.map((r) => [r["_id"], r]));
    expect([...byId.keys()].sort()).toEqual(["LOL-active", "LOL-draft"]);
    expect(byId.get("LOL-draft")).not.toHaveProperty("secret");
  });

  it("keeps a listable row without everyRowNeedsRead, and drops a row the user may not read with it", async () => {
    const listed = await docService.getList("ListOnlyDoc", { fields: ["_id", "title"] }, lister);
    expect(listed.data.map((r) => r["_id"])).toEqual(["LOD-1"]);
    const readable = await docService.getList("ListOnlyDoc", { fields: ["_id", "title"] }, lister, undefined, undefined, { everyRowNeedsRead: true });
    expect(readable.data).toEqual([]);
    expect(readable.total).toBe(0);
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

describe("A person's explicit clear outranks a field default (#227)", () => {
  const clearEntity = makeEntity({
    name: "ClearDoc",
    fields: [
      { fieldname: "due", fieldtype: "Date" as const, label: "Due", default: "__today__" },
      {
        fieldname: "lines",
        fieldtype: "Table" as const,
        label: "Lines",
        child_fields: [
          { fieldname: "product", fieldtype: "Data" as const, label: "Product" },
          { fieldname: "line_date", fieldtype: "Date" as const, label: "Line Date", default: "__today__" },
        ],
      },
    ],
  });

  beforeAll(async () => {
    registry.register(clearEntity);
    await db.ensureCollection("ClearDoc", "app");
  });

  it("stores null for a defaulted Date cleared on a new record and a new row, and the default where the value is missing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await docService.insert(
      "ClearDoc",
      { due: null, lines: [{ product: "P-1", line_date: null }, { product: "P-2" }] },
      adminUser,
    );
    const raw0 = (await db.findOne("ClearDoc", created._id, "app")) as Record<string, unknown>;
    expect(raw0["due"]).toBeNull();
    const rows0 = raw0["lines"] as Record<string, unknown>[];
    expect(rows0[0]!["line_date"]).toBeNull();
    expect(String(rows0[1]!["line_date"]).slice(0, 10)).toBe(today);

    await docService.update(
      "ClearDoc",
      created._id,
      { lines: [...rows0, { product: "P-3", line_date: null }] },
      adminUser,
    );
    const raw1 = (await db.findOne("ClearDoc", created._id, "app")) as Record<string, unknown>;
    const added = (raw1["lines"] as Record<string, unknown>[]).find((r) => r["product"] === "P-3")!;
    expect(added["line_date"]).toBeNull();
  });
});

describe("A Table cell's read_only_depends_on locks the cell on update", () => {
  const clerk: UserContext = { _id: "loan-clerk", email: "loan-clerk@test.local", roles: ["LoanClerk"], full_name: "Clerk" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "LoanDoc",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          {
            fieldname: "lines",
            fieldtype: "Table" as const,
            label: "Lines",
            child_fields: [
              { fieldname: "state", fieldtype: "Data" as const, label: "State" },
              {
                fieldname: "note",
                fieldtype: "Data" as const,
                label: "Note",
                read_only_depends_on: "eval:doc.state=='returned'",
              },
            ],
          },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
          { role: "LoanClerk", level: 0, select: 1, read: 1, write: 1, create: 1 },
        ],
      }),
    );
    await db.ensureCollection("LoanDoc", "app");
  });

  async function storedLines(id: string): Promise<Record<string, unknown>[]> {
    const raw = (await db.findOne("LoanDoc", id, "app")) as Record<string, unknown>;
    return raw["lines"] as Record<string, unknown>[];
  }

  it("refuses an update that changes a locked cell and keeps the stored value", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "scratch on frame" }] },
      clerk,
    );
    const [row] = await storedLines(doc._id);
    await expect(
      docService.update("LoanDoc", doc._id, { lines: [{ ...row, note: "no damage" }] }, clerk),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await storedLines(doc._id))[0]!["note"]).toBe("scratch on frame");
  });

  it("accepts the unchanged locked cell and a change to a cell whose row is not locked", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "kept" }, { state: "out", note: "old" }] },
      clerk,
    );
    const [locked, open] = await storedLines(doc._id);
    await docService.update("LoanDoc", doc._id, { lines: [locked, { ...open, note: "new" }] }, clerk);
    const rows = await storedLines(doc._id);
    expect(rows.map((r) => r["note"])).toEqual(["kept", "new"]);
  });

  it("refuses an update that drops a stored row holding a locked cell (#245)", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "scratch on frame" }, { state: "out", note: "open" }] },
      clerk,
    );
    const [, open] = await storedLines(doc._id);
    await expect(docService.update("LoanDoc", doc._id, { lines: [open] }, clerk)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(docService.update("LoanDoc", doc._id, { lines: null }, clerk)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect((await storedLines(doc._id)).map((r) => r["note"])).toEqual(["scratch on frame", "open"]);
  });

  it("accepts an update that leaves the Table out or drops a row with no locked cell (#245)", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "kept" }, { state: "out", note: "open" }] },
      clerk,
    );
    await docService.update("LoanDoc", doc._id, { title: "M" }, clerk);
    const [locked] = await storedLines(doc._id);
    await docService.update("LoanDoc", doc._id, { lines: [locked] }, clerk);
    expect((await storedLines(doc._id)).map((r) => r["note"])).toEqual(["kept"]);
  });

  it("refuses a locked row resent without its _row_id in place of its stored twin (#245)", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "scratch on frame" }] },
      clerk,
    );
    await expect(
      docService.update("LoanDoc", doc._id, { lines: [{ state: "returned", note: "no damage" }] }, clerk),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await storedLines(doc._id))[0]!["note"]).toBe("scratch on frame");
  });

  it("keeps a row an update stored without _row_id, so a later save of the locked row passes (#245)", async () => {
    const doc = await docService.insert("LoanDoc", { title: "L", lines: [{ state: "out", note: "a" }] }, clerk);
    await docService.update("LoanDoc", doc._id, { lines: [{ state: "returned", note: "a" }] }, clerk);
    const [row] = await storedLines(doc._id);
    expect(typeof row!["_row_id"]).toBe("string");
    const read = await docService.getDoc("LoanDoc", doc._id, clerk);
    await docService.update("LoanDoc", doc._id, { title: "M", lines: read.get("lines") }, clerk);
    expect((await storedLines(doc._id)).map((r) => r["note"])).toEqual(["a"]);
  });

  it("lets an Administrator drop a locked row and resend it without its _row_id (#245)", async () => {
    const doc = await docService.insert(
      "LoanDoc",
      { title: "L", lines: [{ state: "returned", note: "scratch on frame" }, { state: "out", note: "open" }] },
      clerk,
    );
    const [, open] = await storedLines(doc._id);
    await docService.update("LoanDoc", doc._id, { lines: [{ state: "returned", note: "no damage" }, open] }, adminUser);
    expect((await storedLines(doc._id)).map((r) => r["note"])).toEqual(["no damage", "open"]);
    await docService.update("LoanDoc", doc._id, { lines: [open] }, adminUser);
    expect((await storedLines(doc._id)).map((r) => r["note"])).toEqual(["open"]);
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

describe("An owner-only reader's list masks each row as stored, then projects it", () => {
  const buyer: UserContext = { _id: "buyer-001", email: "buyer@test.local", roles: ["Buyer"], full_name: "Buyer" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "OwnedOrder",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          { fieldname: "note", fieldtype: "Data" as const, label: "Note" },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          { role: "Buyer", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, if_owner: 1 },
        ],
      } as Partial<EntityDefinition>),
    );
    await db.ensureCollection("OwnedOrder", "app");
    const row = { doctype: "OwnedOrder", docstatus: 0, modified_by: "system", creation: new Date(), modified: new Date() };
    await db.insertOne("OwnedOrder", { ...row, _id: "OO-mine", owner: buyer.email, title: "Mine", note: "n-mine" }, "app");
    await db.insertOne("OwnedOrder", { ...row, _id: "OO-theirs", owner: "other@test.local", title: "Theirs", note: "n-theirs" }, "app");
  });

  it("answers the projected fields of the reader's own rows, and no other row", async () => {
    const listed = await docService.getList("OwnedOrder", { fields: ["_id", "title"] }, buyer);
    expect(listed.data).toEqual([{ _id: "OO-mine", title: "Mine" }]);
    expect(listed.total).toBe(1);
  });
});

describe("count and exists see only the rows the reader's roles may see", () => {
  const reader: UserContext = { _id: "rv-001", email: "rv@test.local", roles: ["RvReader"], full_name: "Reader" };

  beforeAll(async () => {
    registry.register(
      makeEntity({
        name: "RoleVisibleDoc",
        role_visibility_field: "roles",
        fields: [
          { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
          { fieldname: "roles", fieldtype: "JSON" as const, label: "Roles" },
        ],
        permissions: [
          { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
          { role: "RvReader", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 },
        ],
      } as Partial<EntityDefinition>),
    );
    await db.ensureCollection("RoleVisibleDoc", "app");
    const row = { doctype: "RoleVisibleDoc", docstatus: 0, owner: "system", modified_by: "system", creation: new Date(), modified: new Date() };
    await db.insertOne("RoleVisibleDoc", { ...row, _id: "RV-open", title: "open" }, "app");
    await db.insertOne("RoleVisibleDoc", { ...row, _id: "RV-hidden", title: "hidden", roles: ["Nobody"] }, "app");
  });

  it("counts only the rows the list answers", async () => {
    const listed = await docService.getList("RoleVisibleDoc", {}, reader);
    expect(listed.data.map((r) => r["_id"])).toEqual(["RV-open"]);
    expect(await docService.count("RoleVisibleDoc", [], reader)).toBe(listed.total);
    expect(await docService.count("RoleVisibleDoc", [{ title: "hidden" }], reader)).toBe(0);
    expect(await docService.count("RoleVisibleDoc", [], adminUser)).toBe(2);
  });

  it("finds only a row the reader's roles may see", async () => {
    expect(await docService.exists("RoleVisibleDoc", "RV-hidden", reader)).toBe(false);
    expect(await docService.exists("RoleVisibleDoc", "RV-open", reader)).toBe(true);
    expect(await docService.exists("RoleVisibleDoc", "RV-hidden", adminUser)).toBe(true);
  });
});

describe("A link title shows only where the reader may see it on the target", () => {
  const clerk: UserContext = { _id: "clerk-004", email: "clerk4@test.local", roles: ["TitleClerk"], full_name: "Clerk" };
  const adminRow = { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 };
  let sourceId: string;

  beforeAll(async () => {
    registry.register(makeEntity({
      name: "TitleTarget",
      naming: { strategy: "user_set" },
      title_field: "name",
      fields: [
        { fieldname: "name", fieldtype: "Data" as const, label: "Name" },
        { fieldname: "secret_name", fieldtype: "Data" as const, label: "Secret name", perm_level: 1 },
      ],
      permissions: [adminRow, { role: "TitleClerk", level: 0, select: 1, read: 0, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 }],
    } as Partial<EntityDefinition>));
    registry.register(makeEntity({
      name: "TitleHidden",
      naming: { strategy: "user_set" },
      title_field: "name",
      fields: [{ fieldname: "name", fieldtype: "Data" as const, label: "Name" }],
      permissions: [adminRow],
    } as Partial<EntityDefinition>));
    registry.register(makeEntity({
      name: "TitleSource",
      fields: [
        { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
        { fieldname: "visible", fieldtype: "Link" as const, label: "Visible", target: "TitleTarget" },
        { fieldname: "deep", fieldtype: "Link" as const, label: "Deep", target: "TitleTarget", target_display: "secret_name" },
        { fieldname: "hidden", fieldtype: "Link" as const, label: "Hidden", target: "TitleHidden" },
      ],
      permissions: [adminRow, { role: "TitleClerk", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 }],
    } as Partial<EntityDefinition>));
    for (const name of ["TitleTarget", "TitleHidden", "TitleSource"]) await db.ensureCollection(name, "app");
    await docService.insert("TitleTarget", { _id: "TT-1", name: "Visible name", secret_name: "Secret name" }, adminUser);
    await docService.insert("TitleHidden", { _id: "TH-1", name: "Hidden name" }, adminUser);
    const source = await docService.insert("TitleSource", { title: "S", visible: "TT-1", deep: "TT-1", hidden: "TH-1" }, adminUser);
    sourceId = source._id;
  });

  it("answers the reader the titles of targets they may select, from fields they may read", async () => {
    const doc = (await docService.getDoc("TitleSource", sourceId, clerk)).toJSON() as Record<string, unknown>;
    expect(doc["_link_titles"]).toEqual({ visible: "Visible name" });
    const listed = await docService.getList("TitleSource", {}, clerk);
    expect(listed.data.find((r) => r["_id"] === sourceId)?.["_link_titles"]).toEqual({ visible: "Visible name" });
  });

  it("answers an Administrator every title", async () => {
    const doc = (await docService.getDoc("TitleSource", sourceId, adminUser)).toJSON() as Record<string, unknown>;
    expect(doc["_link_titles"]).toEqual({ visible: "Visible name", deep: "Secret name", hidden: "Hidden name" });
  });
});

describe("A document shared for reading shows what a level-0 read shows", () => {
  // Owner-only reader: level 0 on their own documents, nothing above.
  const reader: UserContext = { _id: "share-001", email: "share-reader@test.local", roles: ["ShareReader"], full_name: "Reader" };
  let sharedId: string;

  beforeAll(async () => {
    registry.register(makeEntity({
      name: "ShareShownDoc",
      fields: [
        { fieldname: "title", fieldtype: "Data" as const, label: "Title" },
        { fieldname: "secret", fieldtype: "Data" as const, label: "Secret", perm_level: 1 },
      ],
      permissions: [
        { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
        { role: "ShareReader", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0, if_owner: 1 },
      ],
    } as Partial<EntityDefinition>));
    await db.ensureCollection("ShareShownDoc", "app");
    await db.ensureCollection(DIGITA.COLLECTIONS.DOC_SHARE, DIGITA.DATABASES.IDENTITY);
    const doc = await docService.insert("ShareShownDoc", { title: "Theirs", secret: "s-theirs" }, adminUser);
    sharedId = doc._id;
    await new DocumentShareService(db).share({
      entity: "ShareShownDoc",
      document_name: sharedId,
      shared_with: reader.email,
      shared_by: adminUser.email,
      can_read: true,
      can_share: false,
      notify: false,
    });
  });

  it("shows the shared document's level-0 fields on getDoc, never a higher level", async () => {
    const seen = (await docService.getDoc("ShareShownDoc", sharedId, reader)).toJSON() as Record<string, unknown>;
    expect(seen["title"]).toBe("Theirs");
    expect(seen).not.toHaveProperty("secret");
  });

  it("shows the same in the list, so a filter or a sort on title reads a value the reader sees", async () => {
    const byTitle = await docService.getList("ShareShownDoc", { filters: [["title", "=", "Theirs"]] }, reader);
    expect(byTitle.data).toHaveLength(1);
    expect(byTitle.data[0]?.["title"]).toBe("Theirs");
    expect(byTitle.data[0]).not.toHaveProperty("secret");
    await expect(docService.getList("ShareShownDoc", { filters: [["secret", "=", "s-theirs"]] }, reader)).rejects.toBeInstanceOf(
      FilterFieldNotAllowedError,
    );
  });
});
