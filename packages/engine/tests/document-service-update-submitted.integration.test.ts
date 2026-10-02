import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

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
import { PermissionChecker, PermissionDeniedError } from "../src/core/permissions/permission-checker.js";
import { HookRunner } from "../src/core/hooks/hook-runner.js";
import { decryptPassword } from "../src/core/entity/password-cipher.js";
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
import { PeriodCloseValidator, PeriodClosedError } from "../src/core/period/period-close-validator.js";
import { DocumentService, ValidationFailedError, ConcurrentModificationError } from "../src/core/document/document-service.js";
import { DocStatusError } from "../src/core/document/docstatus-engine.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES, DIGITA } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import type { BaseDocument } from "../src/core/document/base-document.js";
import { env } from "../src/core/config/env.js";
import type { StoragePort } from "../src/core/storage/storage-port.js";
import { mayReadFile } from "../src/core/storage/file-access.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;
let hookRunner: HookRunner;

const admin: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin User",
};

const viewer: UserContext = {
  _id: "viewer-001",
  email: "viewer@test.local",
  roles: ["Viewer"],
  full_name: "Viewer User",
};

const fullPerms = {
  role: SYSTEM_ROLES.ADMINISTRATOR,
  level: 0,
  select: 1,
  read: 1,
  write: 1,
  create: 1,
  delete: 1,
  submit: 1,
  cancel: 1,
  amend: 1,
};
const viewerPerms = { role: "Viewer", level: 0, select: 1, read: 1, write: 0, create: 0, delete: 0, submit: 0, cancel: 0, amend: 0 };

/** A settlement-shaped submittable entity. */
function settleEntity(name = "SettleDoc"): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "SD-", pad_length: 4 },
    is_submittable: true,
    track_changes: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "grand_total", fieldtype: "Currency", label: "Grand total" }, // FROZEN
      { fieldname: "amount_paid", fieldtype: "Currency", label: "Paid", allow_on_submit: true, default: 0 },
      { fieldname: "amount_due", fieldtype: "Currency", label: "Due", allow_on_submit: true },
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "posted", "paid"], allow_on_submit: true, default: "draft" },
      { fieldname: "note", fieldtype: "Data", label: "Note", allow_on_submit: true },
    ],
    permissions: [fullPerms, viewerPerms],
  } as unknown as EntityDefinition;
}

async function insertSubmitted(
  doctype: string,
  data: Record<string, unknown>,
): Promise<string> {
  const doc = await docService.insert(doctype, data, admin);
  await docService.submit(doctype, doc._id, admin);
  return doc._id;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
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
  hookRunner.setServices({ db, registry, decryptPassword });
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
  const periodCloseValidator = new PeriodCloseValidator(registry, db);

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
    periodCloseValidator,
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

// ─── T3/T4/T5/T9/T17 — scalar band ──────────────────────────────────────────

describe("updateSubmitted — scalar band", () => {
  beforeEach(async () => {
    registry.register(settleEntity("SettleDoc"));
    await db.ensureCollection("SettleDoc", "app");
  });

  it("T3: patches a flagged set + increment, keeps docstatus=1, stamps modified", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", grand_total: 1000, amount_due: 1000 });
    await docService.updateSubmitted(
      "SettleDoc",
      id,
      { increment: { amount_paid: 400, amount_due: -400 }, set: { status: "posted" } },
      admin,
    );
    const raw = await db.findOne("SettleDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(400);
    expect(raw?.["amount_due"]).toBe(600);
    expect(raw?.["status"]).toBe("posted");
    expect(raw?.["docstatus"]).toBe(1);
    expect(raw?.["grand_total"]).toBe(1000); // untouched
  });

  it("T4: rejects a set on an unflagged (frozen) field and persists nothing", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", grand_total: 1000, amount_due: 1000 });
    await expect(
      docService.updateSubmitted("SettleDoc", id, { set: { grand_total: 5 } }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });
    const raw = await db.findOne("SettleDoc", id, "app");
    expect(raw?.["grand_total"]).toBe(1000);
  });

  it("T5: rejects a draft (docstatus 0) and a cancelled (docstatus 2) doc", async () => {
    const draft = await docService.insert("SettleDoc", { title: "Draft", amount_due: 10 }, admin);
    await expect(
      docService.updateSubmitted("SettleDoc", draft._id, { set: { amount_paid: 1 } }, admin),
    ).rejects.toMatchObject({ messageKey: "not_submitted" });

    const id = await insertSubmitted("SettleDoc", { title: "Cx", amount_due: 10 });
    await docService.cancel("SettleDoc", id, admin);
    await expect(
      docService.updateSubmitted("SettleDoc", id, { set: { amount_paid: 1 } }, admin),
    ).rejects.toMatchObject({ messageKey: "not_submitted" });
  });

  it("T9: stale expectedModified throws ConcurrentModificationError", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_due: 10 });
    await expect(
      docService.updateSubmitted(
        "SettleDoc",
        id,
        { increment: { amount_paid: 1 } },
        admin,
        undefined,
        { expectedModified: "1999-01-01T00:00:00.000Z" },
      ),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });

  it("T17: skipWritePermCheck=false rejects a user without write, admin passes", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_due: 10 });
    await expect(
      docService.updateSubmitted("SettleDoc", id, { increment: { amount_paid: 1 } }, viewer),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    // admin (write) passes
    await expect(
      docService.updateSubmitted("SettleDoc", id, { increment: { amount_paid: 1 } }, admin),
    ).resolves.toBeDefined();
  });

  it("T8: concurrent increments are additive (read-modify-write under the tx)", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_paid: 0, amount_due: 1000 });
    await Promise.all([
      docService.updateSubmitted("SettleDoc", id, { increment: { amount_paid: 100 } }, admin),
      docService.updateSubmitted("SettleDoc", id, { increment: { amount_paid: 50 } }, admin),
    ]);
    const raw = await db.findOne("SettleDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(150);
  });

  it("T-sec1: transition() on a workflow-LESS submittable submitted doc is BLOCKED (E5 hole)", async () => {
    // SettleDoc has a `status` Select but NO states/transitions → hasWorkflow=false.
    // transition() must fall through to update(), which hard-blocks a submitted
    // doc — NOT write an arbitrary status via updateSubmitted.
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_due: 10 });
    await expect(docService.transition("SettleDoc", id, "hacked", admin)).rejects.toMatchObject({
      messageKey: "cannot_edit_submitted",
    });
    const raw = await db.findOne("SettleDoc", id, "app");
    expect(raw?.["status"]).not.toBe("hacked");
  });

  it("T-ver: a top-level increment records a version entry with old→new", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_paid: 0, amount_due: 100 });
    await docService.updateSubmitted("SettleDoc", id, { increment: { amount_paid: 40 } }, admin);
    const versions = await db.find(
      "_versions",
      { filters: [{ entity: "SettleDoc", document_name: id }], order_by: "timestamp desc", limit: 5 },
      DIGITA.DATABASES.AUDITS,
    );
    const last = versions[0] as { changes: Array<{ field: string; old: unknown; new: unknown }> };
    const ch = last.changes.find((c) => c.field === "amount_paid");
    expect(ch?.new).toBe(40);
  });

  it("T-so: updateSubmitted joins the caller's transaction via sessionOverride", async () => {
    const id = await insertSubmitted("SettleDoc", { title: "Inv", amount_paid: 0, amount_due: 100 });
    await db.withTransaction(async (session) => {
      await docService.updateSubmitted(
        "SettleDoc",
        id,
        { increment: { amount_paid: 25 } },
        admin,
        undefined,
        { sessionOverride: session, skipWritePermCheck: true, cause: { doctype: "Payment", name: "PAY-9" } },
      );
    });
    const raw = await db.findOne("SettleDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(25);
  });
});

// ─── standard update() hard-block — the source of truth the UI mirrors ───────
// The operator UI (digita-platform/packages/app) renders a submitted/cancelled submittable doc as
// read-only (no Save, lock badge, disabled controls). That UI lock is defence-in-
// depth over THIS service gate: the plain update() path — what the HTTP
// PUT /resource/:doctype/:name calls — must itself refuse the edit. updateSubmitted
// (the narrow allow_on_submit band) is the ONLY sanctioned post-submit mutation and
// has no HTTP verb; the generic edit path stays hard-blocked regardless of field.

describe("update() — hard-blocked on a non-draft submittable doc (UI read-only parity)", () => {
  beforeEach(async () => {
    registry.register(settleEntity("EditGate"));
    await db.ensureCollection("EditGate", "app");
  });

  it("rejects update() of a SUBMITTED doc with cannot_edit_submitted — even a band field, nothing persists", async () => {
    const id = await insertSubmitted("EditGate", { title: "Inv", grand_total: 1000, amount_due: 1000 });
    // amount_paid is allow_on_submit, but the sanctioned path is updateSubmitted() —
    // the generic update() PUT path must still refuse it.
    await expect(
      docService.update("EditGate", id, { title: "hacked", amount_paid: 400 }, admin),
    ).rejects.toMatchObject({ messageKey: "cannot_edit_submitted" });
    await expect(
      docService.update("EditGate", id, { title: "hacked" }, admin),
    ).rejects.toBeInstanceOf(DocStatusError);
    const raw = await db.findOne("EditGate", id, "app");
    expect(raw?.["title"]).toBe("Inv"); // nothing persisted
    expect(raw?.["docstatus"]).toBe(1);
  });

  it("rejects update() of a CANCELLED doc with cannot_edit_cancelled", async () => {
    const id = await insertSubmitted("EditGate", { title: "Cx", amount_due: 10 });
    await docService.cancel("EditGate", id, admin);
    await expect(
      docService.update("EditGate", id, { title: "hacked" }, admin),
    ).rejects.toMatchObject({ messageKey: "cannot_edit_cancelled" });
  });

  it("still allows update() on a DRAFT (docstatus 0) — parity: the UI keeps Save on a draft", async () => {
    const draft = await docService.insert("EditGate", { title: "Draft", amount_due: 10 }, admin);
    await expect(
      docService.update("EditGate", draft._id, { title: "Draft edited" }, admin),
    ).resolves.toBeDefined();
    const raw = await db.findOne("EditGate", draft._id, "app");
    expect(raw?.["title"]).toBe("Draft edited");
    expect(raw?.["docstatus"]).toBe(0);
  });
});

// ─── T6/T7 — hooks ───────────────────────────────────────────────────────────

describe("updateSubmitted — hooks", () => {
  it("T6: a before_submitted_update hook dirtying a non-band field aborts the tx", async () => {
    registry.register(settleEntity("HookDoc"));
    await db.ensureCollection("HookDoc", "app");
    const id = await insertSubmitted("HookDoc", { title: "Inv", grand_total: 1000, amount_due: 1000 });

    // Register a rogue before_submitted_update hook that touches a frozen field.
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "HookDoc",
      new Map([
        ["before_submitted_update", (doc: BaseDocument) => { doc.set("grand_total", 1); }],
      ]),
    );

    await expect(
      docService.updateSubmitted("HookDoc", id, { increment: { amount_paid: 1 } }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });

    // Nothing persisted — neither the hook write nor the patch.
    const raw = await db.findOne("HookDoc", id, "app");
    expect(raw?.["grand_total"]).toBe(1000);
    expect(raw?.["amount_paid"]).toBe(0);

    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("HookDoc");
  });

  it("T-band: a before_submitted_update hook may set a DIFFERENT band field than the patch", async () => {
    // Fable-5 regression: the closing guardrail must allow the WHOLE band, not
    // just the patch's touched fields — a hook maintaining a derived band field
    // (here status, a band field NOT in the patch) must NOT abort the tx.
    registry.register(settleEntity("BandHookDoc"));
    await db.ensureCollection("BandHookDoc", "app");
    const id = await insertSubmitted("BandHookDoc", { title: "Inv", grand_total: 100, amount_due: 100 });

    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "BandHookDoc",
      new Map([
        ["before_submitted_update", (doc: BaseDocument) => { doc.set("status", "posted"); }],
      ]),
    );

    await docService.updateSubmitted("BandHookDoc", id, { increment: { amount_paid: 10 } }, admin);
    const raw = await db.findOne("BandHookDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(10);
    expect(raw?.["status"]).toBe("posted"); // hook's band write persisted (aborted before the fix)

    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("BandHookDoc");
  });

  it("runs on_submitted_update inside the transaction: a throwing handler leaves the row unchanged", async () => {
    registry.register(settleEntity("PaidDoc"));
    await db.ensureCollection("PaidDoc", "app");
    const id = await insertSubmitted("PaidDoc", { title: "Inv", grand_total: 100, amount_due: 100 });
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "PaidDoc",
      new Map([["on_submitted_update", () => { throw new Error("the paid amount does not add up"); }]]),
    );

    await expect(
      docService.updateSubmitted("PaidDoc", id, { increment: { amount_paid: 10 } }, admin),
    ).rejects.toThrow("the paid amount does not add up");
    const raw = await db.findOne("PaidDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(0);

    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("PaidDoc");
  });

  it("T7: draft-era validate/before_save hooks do NOT fire on updateSubmitted", async () => {
    registry.register(settleEntity("QuietDoc"));
    await db.ensureCollection("QuietDoc", "app");
    const id = await insertSubmitted("QuietDoc", { title: "Inv", amount_due: 10 });

    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "QuietDoc",
      new Map([
        ["validate", () => { throw new Error("validate must not fire"); }],
        ["before_save", () => { throw new Error("before_save must not fire"); }],
      ]),
    );

    await expect(
      docService.updateSubmitted("QuietDoc", id, { increment: { amount_paid: 5 } }, admin),
    ).resolves.toBeDefined();
    const raw = await db.findOne("QuietDoc", id, "app");
    expect(raw?.["amount_paid"]).toBe(5);

    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("QuietDoc");
  });
});

// ─── T10/T11/T12 — children[] ────────────────────────────────────────────────

function lineEntity(name = "LineDoc"): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "LD-", pad_length: 4 },
    is_submittable: true,
    track_changes: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "qty", fieldtype: "Float", label: "Qty" }, // FROZEN cell
          { fieldname: "delivered", fieldtype: "Float", label: "Delivered", allow_on_submit: true, default: 0 },
        ],
      },
    ],
    permissions: [fullPerms],
  } as unknown as EntityDefinition;
}

describe("updateSubmitted — children[]", () => {
  beforeEach(async () => {
    registry.register(lineEntity("LineDoc"));
    await db.ensureCollection("LineDoc", "app");
  });

  async function seedThreeLines(): Promise<{ id: string; rowIds: string[] }> {
    const doc = await docService.insert(
      "LineDoc",
      { title: "Order", lines: [{ qty: 10 }, { qty: 20 }, { qty: 30 }] },
      admin,
    );
    await docService.submit("LineDoc", doc._id, admin);
    const raw = await db.findOne("LineDoc", doc._id, "app");
    const rowIds = (raw?.["lines"] as Array<Record<string, unknown>>).map((r) => r["_row_id"] as string);
    return { id: doc._id, rowIds };
  }

  it("T10: patches ONE row by _row_id, leaves siblings byte-identical", async () => {
    const { id, rowIds } = await seedThreeLines();
    await docService.updateSubmitted(
      "LineDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[1]!, increment: { delivered: 5 } }] },
      admin,
    );
    const raw = await db.findOne("LineDoc", id, "app");
    const lines = raw?.["lines"] as Array<Record<string, unknown>>;
    expect(lines[0]!["delivered"] ?? 0).toBe(0);
    expect(lines[1]!["delivered"]).toBe(5);
    expect(lines[2]!["delivered"] ?? 0).toBe(0);
    // identity + order stable
    expect(lines.map((l) => l["_row_id"])).toEqual(rowIds);
    expect(lines.map((l) => l["qty"])).toEqual([10, 20, 30]);
  });

  it("T11: missing row_id, unflagged cell, and _row_id-as-cell are rejected", async () => {
    const { id, rowIds } = await seedThreeLines();
    await expect(
      docService.updateSubmitted("LineDoc", id, { children: [{ table: "lines", row_id: "ghost", increment: { delivered: 1 } }] }, admin),
    ).rejects.toMatchObject({ messageKey: "missing_child_row" });
    await expect(
      docService.updateSubmitted("LineDoc", id, { children: [{ table: "lines", row_id: rowIds[0]!, set: { qty: 99 } }] }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });
    await expect(
      docService.updateSubmitted("LineDoc", id, { children: [{ table: "lines", row_id: rowIds[0]!, set: { _row_id: "x" } }] }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });
  });

  it("T12: records a per-row version entry and a post_submit activity row with cause", async () => {
    const { id, rowIds } = await seedThreeLines();
    await docService.updateSubmitted(
      "LineDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[2]!, increment: { delivered: 7 } }] },
      admin,
      undefined,
      { cause: { doctype: "SalesDeliveryNote", name: "DN-1" } },
    );

    const versions = await db.find(
      "_versions",
      { filters: [{ entity: "LineDoc", document_name: id }], order_by: "timestamp desc", limit: 5 },
      DIGITA.DATABASES.AUDITS,
    );
    const last = versions[0] as { changes: Array<{ field: string; new: unknown }> };
    const rowChange = last.changes.find((c) => c.field === `lines[${rowIds[2]}].delivered`);
    expect(rowChange?.new).toBe(7);
    // no whole-array "lines" entry
    expect(last.changes.some((c) => c.field === "lines")).toBe(false);

    const logs = await db.find(
      DIGITA.COLLECTIONS.LOG,
      { filters: [{ entity: "LineDoc", document_name: id, action: "Updated" }], order_by: "creation desc", limit: 5 },
      "logs",
    );
    const details = (logs[0] as { details: Record<string, unknown> }).details;
    expect(details["post_submit"]).toBe(true);
    expect(details["cause"]).toEqual({ doctype: "SalesDeliveryNote", name: "DN-1" });
    expect((details["children"] as Array<Record<string, unknown>>)[0]!["row_id"]).toBe(rowIds[2]);
  });
});

// ─── T13 — the dedicated post_submit_update period phase ─────────────────────

function periodDocEntity(name: string, blockOn: string[]): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "PD-", pad_length: 4 },
    is_submittable: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "posting_date", fieldtype: "Date", label: "Posting date", required: true },
      { fieldname: "amount_paid", fieldtype: "Currency", label: "Paid", allow_on_submit: true, default: 0 },
    ],
    period_check: { date_field: "posting_date", period_entity: "FiscalPeriod", block_on: blockOn as never },
    permissions: [fullPerms],
  } as unknown as EntityDefinition;
}

describe("updateSubmitted — post_submit_update period phase (D3)", () => {
  let periodId: string;

  beforeAll(async () => {
    registry.register({
      name: "FiscalPeriod",
      module: "test",
      database: "app" as const,
      naming: { strategy: "auto_increment", prefix: "FP-", pad_length: 4 },
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "start_date", fieldtype: "Date", label: "Start" },
        { fieldname: "end_date", fieldtype: "Date", label: "End" },
        { fieldname: "is_closed", fieldtype: "Check", label: "Closed", default: 0 },
      ],
      permissions: [fullPerms],
    } as unknown as EntityDefinition);
    await db.ensureCollection("FiscalPeriod", "app");
    registry.register(periodDocEntity("SealDoc", ["submit", "post_submit_update"]));
    registry.register(periodDocEntity("NoSealDoc", ["submit"]));
    await db.ensureCollection("SealDoc", "app");
    await db.ensureCollection("NoSealDoc", "app");

    const p = await docService.insert(
      "FiscalPeriod",
      { title: "2026-06", start_date: "2026-06-01", end_date: "2026-06-30", is_closed: 0 },
      admin,
    );
    periodId = p._id;
  });

  async function closePeriod(): Promise<void> {
    await db.updateOne("FiscalPeriod", periodId, { is_closed: true }, "app");
  }
  async function openPeriod(): Promise<void> {
    await db.updateOne("FiscalPeriod", periodId, { is_closed: false }, "app");
  }

  it("blocks a post-submit patch into a closed period on the sealing entity", async () => {
    await openPeriod();
    const id = await insertSubmitted("SealDoc", { title: "S", posting_date: "2026-06-15" });
    await closePeriod();
    await expect(
      docService.updateSubmitted("SealDoc", id, { increment: { amount_paid: 10 } }, admin),
    ).rejects.toBeInstanceOf(PeriodClosedError);
  });

  it("allows the same patch on an entity that does NOT list post_submit_update", async () => {
    await openPeriod();
    const id = await insertSubmitted("NoSealDoc", { title: "N", posting_date: "2026-06-15" });
    await closePeriod();
    await expect(
      docService.updateSubmitted("NoSealDoc", id, { increment: { amount_paid: 10 } }, admin),
    ).resolves.toBeDefined();
  });

  afterAll(async () => {
    await openPeriod();
  });
});

// ─── LinkValidator threads the session (in-tx link target visible) ───────────
// A createCreditNote-style flow inserts a doc, then stamps a submitted doc's
// allow_on_submit Link to the just-inserted (still-uncommitted) target within the
// SAME transaction. Before the fix the link existence read ran sessionless → the
// in-tx target was invisible → link_not_found. Now validate() threads the session.

describe("updateSubmitted — link validation joins the caller's transaction", () => {
  const linkTargetEntity = (): EntityDefinition =>
    ({
      name: "LinkTarget",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
      permissions: [fullPerms],
    }) as unknown as EntityDefinition;

  const linkBandEntity = (): EntityDefinition =>
    ({
      name: "LinkBand",
      module: "test",
      database: "app",
      naming: { strategy: "auto_increment", prefix: "LB-", pad_length: 4 },
      is_submittable: true,
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
        { fieldname: "ref", fieldtype: "Link", target: "LinkTarget", label: "Ref", allow_on_submit: true },
      ],
      permissions: [fullPerms],
    }) as unknown as EntityDefinition;

  beforeEach(async () => {
    registry.register(linkTargetEntity());
    registry.register(linkBandEntity());
    await db.ensureCollection("LinkTarget", "app");
    await db.ensureCollection("LinkBand", "app");
  });

  it("stamps an allow_on_submit Link to a target created in the SAME transaction", async () => {
    const band = await docService.insert("LinkBand", { title: "b" }, admin);
    await docService.submit("LinkBand", band._id, admin);

    await db.withTransaction(async (session) => {
      const target = await docService.insert(
        "LinkTarget",
        { _id: "T-1", title: "t" },
        admin,
        undefined,
        session,
      );
      await docService.updateSubmitted(
        "LinkBand",
        band._id,
        { set: { ref: target._id } },
        admin,
        undefined,
        { sessionOverride: session, skipWritePermCheck: true },
      );
    });

    const raw = await db.findOne("LinkBand", band._id, "app");
    expect(raw?.["ref"]).toBe("T-1"); // link resolved against the in-tx target
  });
});

// ─── D5 — post-submit computed refresh ───────────────────────────────────────
// A computed header rollup over an allow_on_submit line counter (the
// BlanketOrder.total_released shape) must refresh when updateSubmitted bumps
// the counter — "a computed field always equals the computation of its
// inputs". The refresh is fenced: only declared computed targets (plus the
// band) may effectively change; a value-identical object re-set (the common
// `doc.set("lines", lines)` handler idiom) is un-dirtied; a genuine change to
// a frozen non-computed field still aborts in the closing band guardrail.

/** Rollup-shaped: computed header totals over a band line counter. */
function rollupEntity(name = "RollupDoc"): EntityDefinition {
  return {
    name,
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "RU-", pad_length: 4 },
    is_submittable: true,
    track_changes: true,
    hooks: {
      // Never file-loaded here (the handler is poked into the runner's map
      // below) — but the DECLARATION is what keys the engine's post-submit
      // computed refresh and its guardrail allowance for the target fields.
      computed: {
        total_ceiling: "stub.computeTotals",
        total_released: "stub.computeTotals",
      },
    },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "note", fieldtype: "Data", label: "Note", allow_on_submit: true },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "quantity", fieldtype: "Float", label: "Qty" }, // FROZEN cell
          { fieldname: "unit_price", fieldtype: "Currency", label: "Price" }, // FROZEN cell
          { fieldname: "released_quantity", fieldtype: "Float", label: "Released", allow_on_submit: true, default: 0 },
        ],
      },
      { fieldname: "total_ceiling", fieldtype: "Currency", label: "Ceiling", read_only: true },
      { fieldname: "total_released", fieldtype: "Currency", label: "Released total", read_only: true },
    ],
    permissions: [fullPerms],
  } as unknown as EntityDefinition;
}

describe("updateSubmitted — computed refresh (D5)", () => {
  /** Mirrors the ERP computeTotals idiom: header totals from lines PLUS the
   *  always-dirty `doc.set("lines", lines)` re-set of the (unmodified) array. */
  const computeRollups = async (doc: BaseDocument): Promise<void> => {
    const lines = (doc.get("lines") as Array<Record<string, unknown>> | undefined) ?? [];
    let ceiling = 0;
    let released = 0;
    for (const ln of lines) {
      ceiling += Number(ln["quantity"] ?? 0) * Number(ln["unit_price"] ?? 0);
      released += Number(ln["released_quantity"] ?? 0) * Number(ln["unit_price"] ?? 0);
    }
    doc.set("lines", lines); // object-like → ALWAYS marks dirty, even unchanged
    doc.set("total_ceiling", ceiling);
    doc.set("total_released", released);
  };

  beforeEach(async () => {
    registry.register(rollupEntity("RollupDoc"));
    await db.ensureCollection("RollupDoc", "app");
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "RollupDoc",
      new Map([
        ["computed:total_ceiling", computeRollups],
        ["computed:total_released", computeRollups],
      ]) as never,
    );
  });

  afterEach(() => {
    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("RollupDoc");
    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("DriftDoc");
  });

  async function seedSubmittedRollup(): Promise<{ id: string; rowIds: string[] }> {
    const doc = await docService.insert(
      "RollupDoc",
      {
        title: "BO",
        lines: [
          { quantity: 10, unit_price: 5 }, // ceiling 50
          { quantity: 4, unit_price: 25 }, // ceiling 100
        ],
      },
      admin,
    );
    await docService.submit("RollupDoc", doc._id, admin);
    const raw = await db.findOne("RollupDoc", doc._id, "app");
    const rowIds = (raw?.["lines"] as Array<Record<string, unknown>>).map((r) => r["_row_id"] as string);
    return { id: doc._id, rowIds };
  }

  it("leaves a declared computed target out of the read_only_depends_on lock", async () => {
    const entity = rollupEntity("RollupDoc");
    entity.fields.find((f) => f.fieldname === "total_released")!.read_only_depends_on = "eval:doc.docstatus==1";
    registry.register(entity);
    const { id, rowIds } = await seedSubmittedRollup();
    await docService.updateSubmitted(
      "RollupDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[0]!, increment: { released_quantity: 3 } }] },
      viewer,
      undefined,
      { skipWritePermCheck: true },
    );
    expect((await db.findOne("RollupDoc", id, "app"))?.["total_released"]).toBe(15);
  });

  it("D5-1: bumping a band line counter refreshes the computed header rollup (in DB, versioned)", async () => {
    const { id, rowIds } = await seedSubmittedRollup();
    const before = await db.findOne("RollupDoc", id, "app");
    expect(before?.["total_ceiling"]).toBe(150);
    expect(before?.["total_released"]).toBe(0);

    await docService.updateSubmitted(
      "RollupDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[0]!, increment: { released_quantity: 3 } }] },
      admin,
    );

    const raw = await db.findOne("RollupDoc", id, "app");
    expect(raw?.["total_released"]).toBe(15); // 3 × 5 — REFRESHED (stale 0 before D5)
    expect(raw?.["total_ceiling"]).toBe(150); // recomputed from frozen inputs → unchanged
    expect(raw?.["docstatus"]).toBe(1);
    const lines = raw?.["lines"] as Array<Record<string, unknown>>;
    expect(lines[0]!["released_quantity"]).toBe(3);
    expect(lines[0]!["quantity"]).toBe(10); // frozen cells untouched
    expect(lines[1]!["released_quantity"] ?? 0).toBe(0);

    // The refresh is version-tracked like any other top-level change.
    const versions = await db.find(
      "_versions",
      { filters: [{ entity: "RollupDoc", document_name: id }], order_by: "timestamp desc", limit: 5 },
      DIGITA.DATABASES.AUDITS,
    );
    const last = versions[0] as { changes: Array<{ field: string; old: unknown; new: unknown }> };
    const ch = last.changes.find((c) => c.field === "total_released");
    expect(ch).toMatchObject({ old: 0, new: 15 });
  });

  it("D5-2: a value-identical lines re-set by the handler is un-dirtied — a header-only band patch passes", async () => {
    const { id } = await seedSubmittedRollup();

    // Patch does NOT touch `lines`; the handler still re-sets the (unchanged)
    // array. Without the no-op cleanup the closing guardrail would abort with
    // field_not_allowed_on_submit on `lines`.
    await docService.updateSubmitted("RollupDoc", id, { set: { note: "checked" } }, admin);

    const raw = await db.findOne("RollupDoc", id, "app");
    expect(raw?.["note"]).toBe("checked");
    expect(raw?.["total_released"]).toBe(0);
    expect(raw?.["total_ceiling"]).toBe(150);

    // And the version entry carries no phantom `lines` change.
    const versions = await db.find(
      "_versions",
      { filters: [{ entity: "RollupDoc", document_name: id }], order_by: "timestamp desc", limit: 5 },
      DIGITA.DATABASES.AUDITS,
    );
    const last = versions[0] as { changes: Array<{ field: string }> };
    expect(last.changes.some((c) => c.field === "lines")).toBe(false);
  });

  it("D5-3: a computed handler that genuinely mutates a frozen NON-computed field still aborts the tx", async () => {
    const drift = {
      ...rollupEntity("DriftDoc"),
      hooks: { computed: { derived_total: "stub.computeDrift" } },
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount" }, // FROZEN
        { fieldname: "counter", fieldtype: "Float", label: "Counter", allow_on_submit: true, default: 0 },
        { fieldname: "derived_total", fieldtype: "Currency", label: "Derived", read_only: true },
        { fieldname: "frozen_note", fieldtype: "Data", label: "Frozen note" }, // FROZEN, not computed
      ],
    } as unknown as EntityDefinition;
    registry.register(drift);
    await db.ensureCollection("DriftDoc", "app");
    // The handler emits a DIFFERENT frozen_note value on every run (like a
    // live master-data lookup whose source drifted after submit) — the draft
    // and submit runs may write it freely, the post-submit re-run must not.
    let driftCalls = 0;
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "DriftDoc",
      new Map([
        [
          "computed:derived_total",
          async (doc: BaseDocument) => {
            doc.set("derived_total", Number(doc.get("amount") ?? 0) * 2);
            // Drifted external input leaking into a frozen field the entity
            // never declared as computed — must NOT slip through post-submit.
            driftCalls += 1;
            doc.set("frozen_note", `drift-${driftCalls}`);
          },
        ],
      ]) as never,
    );

    const doc = await docService.insert("DriftDoc", { title: "D", amount: 10 }, admin);
    await docService.submit("DriftDoc", doc._id, admin);
    const committed = await db.findOne("DriftDoc", doc._id, "app");
    const frozenAtSubmit = committed?.["frozen_note"];

    await expect(
      docService.updateSubmitted("DriftDoc", doc._id, { increment: { counter: 1 } }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });

    // Nothing persisted — neither the drifted write nor the band patch.
    const raw = await db.findOne("DriftDoc", doc._id, "app");
    expect(raw?.["frozen_note"]).toBe(frozenAtSubmit);
    expect(raw?.["counter"] ?? 0).toBe(0);
  });

  it("D5-5: a type-flapping but value-identical primitive hook write is tolerated (Check stored Boolean, hook writes 0/1)", async () => {
    // Real-world shape: a handler flags `doc.set("flagged", qualifies ? 1 : 0)`
    // on a Check field whose STORED form is a serialized Boolean. Post-submit
    // the recompute yields the same truth value in a different representation —
    // that must NOT read as a frozen-core mutation, and the stored
    // representation must be kept.
    const flagged = {
      ...rollupEntity("FlagDoc"),
      hooks: { computed: { derived_total: "stub.computeFlag" } },
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount" }, // FROZEN
        { fieldname: "counter", fieldtype: "Float", label: "Counter", allow_on_submit: true, default: 0 },
        { fieldname: "derived_total", fieldtype: "Currency", label: "Derived", read_only: true },
        { fieldname: "audited", fieldtype: "Check", label: "Audited", read_only: true }, // FROZEN, not computed
      ],
    } as unknown as EntityDefinition;
    registry.register(flagged);
    await db.ensureCollection("FlagDoc", "app");
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "FlagDoc",
      new Map([
        [
          "computed:derived_total",
          async (doc: BaseDocument) => {
            doc.set("derived_total", Number(doc.get("amount") ?? 0) * 2);
            doc.set("audited", 0); // raw 0/1 idiom — stored form is Boolean false
          },
        ],
      ]) as never,
    );

    const doc = await docService.insert("FlagDoc", { title: "F", amount: 10 }, admin);
    await docService.submit("FlagDoc", doc._id, admin);
    // Simulate the canonical serialized form other engine paths persist
    // (Check → Boolean) so the loaded original is `false` while the hook
    // re-writes `0` — value-identical, representation-flapped.
    await db.updateOne("FlagDoc", doc._id, { audited: false }, "app");

    await docService.updateSubmitted("FlagDoc", doc._id, { increment: { counter: 2 } }, admin);

    const raw = await db.findOne("FlagDoc", doc._id, "app");
    expect(raw?.["counter"]).toBe(2); // band patch applied
    expect(raw?.["audited"]).toBe(false); // stored representation KEPT (no phantom rewrite)

    (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("FlagDoc");
  });

  it("D5-4: callers still cannot set a computed target directly through the patch band", async () => {
    const { id } = await seedSubmittedRollup();
    await expect(
      docService.updateSubmitted("RollupDoc", id, { set: { total_released: 999 } }, admin),
    ).rejects.toMatchObject({ messageKey: "field_not_allowed_on_submit" });
    const raw = await db.findOne("RollupDoc", id, "app");
    expect(raw?.["total_released"]).toBe(0);
  });
});

describe("updateSubmitted — an attach cell of a Table in the band", () => {
  const clerk: UserContext = { _id: "clerk-001", email: "clerk@test.local", roles: ["System User"] };
  let fileSeq = 0;

  beforeAll(async () => {
    const { readFile } = await import("fs/promises");
    registry.register(JSON.parse(await readFile(new URL("../src/entities/File.entity.json", import.meta.url), "utf8")));
    // A flagged Table opens every cell of its rows to a post-submit patch, an attach cell too.
    registry.register({
      name: "ReceiptDoc",
      module: "test",
      database: "app",
      naming: { strategy: "auto_increment", prefix: "RD-", pad_length: 4 },
      is_submittable: true,
      storage_path: "receipts",
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "receipts", fieldtype: "Table", label: "Receipts", allow_on_submit: true, child_fields: [{ fieldname: "scan", fieldtype: "Attach", label: "Scan" }] },
      ],
      permissions: [fullPerms, { role: "System User", level: 0, select: 1, read: 1, write: 1 }],
    } as unknown as EntityDefinition);
    await db.ensureCollection("ReceiptDoc", "app");
    await db.ensureCollection(DIGITA.COLLECTIONS.FILE, "core");
  });

  async function uploadedBy(owner: string): Promise<string> {
    const id = `FILE-RD${String(++fileSeq).padStart(4, "0")}`;
    const fileUrl = `/api/v1/file/${id}/download`;
    await db.insertOne(DIGITA.COLLECTIONS.FILE, { _id: id, file_name: "scan.pdf", file_url: fileUrl, attached_to_entity: "ReceiptDoc", is_private: true, owner }, "core");
    return fileUrl;
  }

  it("refuses a patch that names a file the user may not read, or no file at all", async () => {
    const doc = await docService.insert("ReceiptDoc", { title: "Paid", receipts: [{ scan: null }] }, admin);
    await docService.submit("ReceiptDoc", doc._id, admin);
    const rowId = ((await db.findOne("ReceiptDoc", doc._id, "app"))?.["receipts"] as Array<Record<string, unknown>>)[0]!["_row_id"] as string;
    const patchScan = (scan: string) =>
      docService.updateSubmitted("ReceiptDoc", doc._id, { children: [{ table: "receipts", row_id: rowId, set: { scan } }] }, clerk);

    await expect(patchScan(await uploadedBy("colleague@test.local"))).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(patchScan("/api/v1/file/FILE-RD9999/download")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(patchScan(await uploadedBy(clerk.email))).resolves.toBeDefined();
  });

  it("binds the patcher's own upload so a colleague may read it, and deletes it when a later patch removes it", async () => {
    const colleague: UserContext = { _id: "colleague-001", email: "colleague@test.local", roles: ["System User"] };
    const deleted: string[] = [];
    const storage = { delete: async (key: string) => void deleted.push(key) } as unknown as StoragePort;
    const service = docService as unknown as { storage?: StoragePort };
    service.storage = storage;
    try {
      const doc = await docService.insert("ReceiptDoc", { title: "Paid", receipts: [{ scan: null }] }, admin);
      await docService.submit("ReceiptDoc", doc._id, admin);
      const rowId = ((await db.findOne("ReceiptDoc", doc._id, "app"))?.["receipts"] as Array<Record<string, unknown>>)[0]!["_row_id"] as string;
      const patchScan = (scan: string | null) =>
        docService.updateSubmitted("ReceiptDoc", doc._id, { children: [{ table: "receipts", row_id: rowId, set: { scan } }] }, clerk);
      const scan = await uploadedBy(clerk.email);
      const fileId = scan.split("/")[4]!;
      await db.updateOne(DIGITA.COLLECTIONS.FILE, fileId, { storage_key: `receipts/${fileId}` }, "core");

      await patchScan(scan);
      const file = (await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, "core")) as Record<string, unknown>;
      expect(file["attached_to_name"]).toBe(doc._id);
      const access = { db, registry, permissionChecker: new PermissionChecker(registry) };
      expect(await mayReadFile(access, colleague, file)).toBe(true);

      await patchScan(null);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, "core")).toBeNull();
      expect(deleted).toEqual([`receipts/${fileId}`]);
    } finally {
      service.storage = undefined;
    }
  });

  it("PLANTED INNOCENT: binds no colleague's file a patch names, and deletes none it removes", async () => {
    const deleted: string[] = [];
    const service = docService as unknown as { storage?: StoragePort };
    service.storage = { delete: async (key: string) => void deleted.push(key) } as unknown as StoragePort;
    try {
      const doc = await docService.insert("ReceiptDoc", { title: "Paid", receipts: [{ scan: null }] }, admin);
      await docService.submit("ReceiptDoc", doc._id, admin);
      const rowId = ((await db.findOne("ReceiptDoc", doc._id, "app"))?.["receipts"] as Array<Record<string, unknown>>)[0]!["_row_id"] as string;
      const scan = await uploadedBy("colleague@test.local");
      const fileId = scan.split("/")[4]!;
      // An Administrator may read every file, so the patch is taken, but the file stays its uploader's.
      await docService.updateSubmitted("ReceiptDoc", doc._id, { children: [{ table: "receipts", row_id: rowId, set: { scan } }] }, admin);
      expect(((await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, "core")) as Record<string, unknown>)["attached_to_name"]).toBeUndefined();
      await docService.updateSubmitted("ReceiptDoc", doc._id, { children: [{ table: "receipts", row_id: rowId, set: { scan: null } }] }, admin);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await db.findOne(DIGITA.COLLECTIONS.FILE, fileId, "core")).not.toBeNull();
      expect(deleted).toEqual([]);
    } finally {
      service.storage = undefined;
    }
  });
});

// ─── read_only_depends_on on the patch path ─────────────────────────────────

describe("updateSubmitted — a read_only_depends_on lock holds for a hook, a rule and a transition", () => {
  // `note` and `counter` lock while `locked` is set; a line's `delivered` locks while its row is sealed.
  function lockEntity(name = "LockDoc"): EntityDefinition {
    return {
      name,
      module: "test",
      database: "app" as const,
      naming: { strategy: "auto_increment", prefix: "LK-", pad_length: 4 },
      is_submittable: true,
      track_changes: true,
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
        { fieldname: "locked", fieldtype: "Check", label: "Locked", allow_on_submit: true, default: 0 },
        { fieldname: "note", fieldtype: "Data", label: "Note", allow_on_submit: true, read_only_depends_on: "eval:doc.locked==1" },
        { fieldname: "counter", fieldtype: "Int", label: "Counter", allow_on_submit: true, default: 0, read_only_depends_on: "eval:doc.locked==1" },
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [
            { fieldname: "sealed", fieldtype: "Check", label: "Sealed", allow_on_submit: true },
            { fieldname: "delivered", fieldtype: "Float", label: "Delivered", allow_on_submit: true, default: 0, read_only_depends_on: "eval:doc.sealed==1" },
          ],
        },
        {
          // The Table itself locks while `locked` is set, whatever its cells allow.
          fieldname: "steps",
          fieldtype: "Table",
          label: "Steps",
          read_only_depends_on: "eval:doc.locked==1",
          child_fields: [{ fieldname: "done", fieldtype: "Check", label: "Done", allow_on_submit: true }],
        },
      ],
      permissions: [fullPerms, viewerPerms],
    } as unknown as EntityDefinition;
  }

  beforeEach(async () => {
    registry.register(lockEntity("LockDoc"));
    await db.ensureCollection("LockDoc", "app");
  });

  async function lockedDoc(): Promise<{ id: string; rowIds: string[] }> {
    const id = await insertSubmitted("LockDoc", {
      title: "Locked",
      locked: 1,
      note: "kept",
      lines: [{ sealed: 0 }, { sealed: 1 }],
      steps: [{ done: 0 }],
    });
    const raw = await db.findOne("LockDoc", id, "app");
    return { id, rowIds: (raw?.["lines"] as Array<Record<string, unknown>>).map((r) => r["_row_id"] as string) };
  }

  // A hook settles a document as the user who triggered it, who may not write it (skipWritePermCheck).
  const asHook = { skipWritePermCheck: true };

  it("refuses a hook's change of a locked field, and of a locked counter, by an actor without write", async () => {
    const { id } = await lockedDoc();
    await expect(
      docService.updateSubmitted("LockDoc", id, { set: { note: "changed" } }, viewer, undefined, asHook),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      docService.updateSubmitted("LockDoc", id, { increment: { counter: 1 } }, viewer, undefined, asHook),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const raw = await db.findOne("LockDoc", id, "app");
    expect([raw?.["note"], raw?.["counter"]]).toEqual(["kept", 0]);
  });

  it("passes a patch that releases the lock in the same save", async () => {
    const { id } = await lockedDoc();
    await docService.updateSubmitted("LockDoc", id, { set: { locked: 0, note: "released" } }, viewer, undefined, asHook);
    expect((await db.findOne("LockDoc", id, "app"))?.["note"]).toBe("released");
  });

  it("holds the Administrator's patch of a locked field too, until his patch releases the lock", async () => {
    const { id } = await lockedDoc();
    await expect(docService.updateSubmitted("LockDoc", id, { set: { note: "by admin" } }, admin)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect((await db.findOne("LockDoc", id, "app"))?.["note"]).toBe("kept");
    await docService.updateSubmitted("LockDoc", id, { set: { locked: 0, note: "by admin" } }, admin);
    expect((await db.findOne("LockDoc", id, "app"))?.["note"]).toBe("by admin");
  });

  it("passes a row patch that releases its own cell lock, judged on the row it produces", async () => {
    const { id, rowIds } = await lockedDoc();
    await docService.updateSubmitted(
      "LockDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[1]!, set: { sealed: 0 }, increment: { delivered: 3 } }] },
      viewer,
      undefined,
      asHook,
    );
    const lines = (await db.findOne("LockDoc", id, "app"))?.["lines"] as Array<Record<string, unknown>>;
    expect(lines[1]!["delivered"]).toBe(3);
  });

  it("refuses a row patch of a Table whose own lock holds", async () => {
    const { id } = await lockedDoc();
    const stepId = ((await db.findOne("LockDoc", id, "app"))?.["steps"] as Array<Record<string, unknown>>)[0]!["_row_id"] as string;
    await expect(
      docService.updateSubmitted(
        "LockDoc",
        id,
        { children: [{ table: "steps", row_id: stepId, set: { done: 1 } }] },
        viewer,
        undefined,
        asHook,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a before_submitted_update hook that changes a locked cell in place", async () => {
    const { id, rowIds } = await lockedDoc();
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "LockDoc",
      new Map([
        [
          "before_submitted_update",
          (doc: BaseDocument) => {
            const lines = doc.get("lines") as Array<Record<string, unknown>>;
            lines[1]!["delivered"] = 99;
            doc.set("lines", lines);
          },
        ],
      ]),
    );
    try {
      await expect(
        docService.updateSubmitted(
          "LockDoc",
          id,
          { children: [{ table: "lines", row_id: rowIds[0]!, increment: { delivered: 1 } }] },
          viewer,
          undefined,
          asHook,
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    } finally {
      (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("LockDoc");
    }
    const lines = (await db.findOne("LockDoc", id, "app"))?.["lines"] as Array<Record<string, unknown>>;
    expect(lines.map((l) => l["delivered"] ?? 0)).toEqual([0, 0]);
  });

  it("refuses a before_submitted_update hook that drops a row holding a locked cell", async () => {
    const { id, rowIds } = await lockedDoc();
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "LockDoc",
      new Map([["before_submitted_update", (doc: BaseDocument) => {
        doc.set("lines", (doc.get("lines") as Array<Record<string, unknown>>).filter((l) => !l["sealed"]));
      }]]),
    );
    try {
      await expect(
        docService.updateSubmitted(
          "LockDoc",
          id,
          { children: [{ table: "lines", row_id: rowIds[0]!, increment: { delivered: 1 } }] },
          viewer,
          undefined,
          asHook,
        ),
      ).rejects.toMatchObject({ code: "permission_denied_locked_row" });
    } finally {
      (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("LockDoc");
    }
    expect(((await db.findOne("LockDoc", id, "app"))?.["lines"] as unknown[]).length).toBe(2);
  });

  it("holds a hook acting for an Administrator that drops a row with a locked cell, as it holds him", async () => {
    const { id, rowIds } = await lockedDoc();
    const before = ((await db.findOne("LockDoc", id, "app"))?.["lines"] as unknown[]).length;
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "LockDoc",
      new Map([["before_submitted_update", (doc: BaseDocument) => {
        doc.set("lines", (doc.get("lines") as Array<Record<string, unknown>>).filter((l) => !l["sealed"]));
      }]]),
    );
    try {
      await expect(
        docService.updateSubmitted(
          "LockDoc",
          id,
          { children: [{ table: "lines", row_id: rowIds[0]!, increment: { delivered: 1 } }] },
          admin,
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    } finally {
      (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("LockDoc");
    }
    expect(((await db.findOne("LockDoc", id, "app"))?.["lines"] as unknown[]).length).toBe(before);
  });

  it("leaves a computed Table out: its hook may drop a row that holds a locked cell", async () => {
    registry.register({ ...lockEntity("LockDoc"), hooks: { computed: { lines: "lock/doc.rebuildLines" } } } as unknown as EntityDefinition);
    const { id, rowIds } = await lockedDoc();
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "LockDoc",
      new Map([["computed:lines", (doc: BaseDocument) => {
        doc.set("lines", (doc.get("lines") as Array<Record<string, unknown>>).filter((l) => !l["sealed"]));
      }]]),
    );
    try {
      await docService.updateSubmitted(
        "LockDoc",
        id,
        { children: [{ table: "lines", row_id: rowIds[0]!, increment: { delivered: 1 } }] },
        viewer,
        undefined,
        asHook,
      );
    } finally {
      (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("LockDoc");
    }
    expect(((await db.findOne("LockDoc", id, "app"))?.["lines"] as unknown[]).length).toBe(1);
  });

  it("judges a row patch on its own row: a locked cell is refused, a row beside a locked one passes", async () => {
    const { id, rowIds } = await lockedDoc();
    await docService.updateSubmitted(
      "LockDoc",
      id,
      { children: [{ table: "lines", row_id: rowIds[0]!, increment: { delivered: 2 } }] },
      viewer,
      undefined,
      asHook,
    );
    await expect(
      docService.updateSubmitted(
        "LockDoc",
        id,
        { children: [{ table: "lines", row_id: rowIds[1]!, increment: { delivered: 2 } }] },
        viewer,
        undefined,
        asHook,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const lines = (await db.findOne("LockDoc", id, "app"))?.["lines"] as Array<Record<string, unknown>>;
    expect(lines.map((l) => l["delivered"] ?? 0)).toEqual([2, 0]);
  });
});

describe("updateSubmitted — a required Password the record keeps", () => {
  const stored = { key_id: "k1", iv: "aXY=", tag: "dGFn", data: "ZGF0YQ==" };
  beforeEach(async () => {
    const entity = settleEntity("SecretDoc");
    entity.fields.push({ fieldname: "secret", fieldtype: "Password", label: "Secret", required: true } as never);
    registry.register(entity);
    await db.ensureCollection("SecretDoc", "app");
  });
  const plant = (id: string, secret?: unknown) =>
    db.insertOne(
      "SecretDoc",
      { _id: id, doctype: "SecretDoc", docstatus: 1, owner: admin.email, modified_by: admin.email, creation: new Date(), modified: new Date(), title: "Inv", ...(secret ? { secret } : {}) },
      "app",
    );

  it("PLANTED DEFECT: patches a submitted record without the password, and keeps the stored one", async () => {
    await plant("SEC-1", stored);
    await docService.updateSubmitted("SecretDoc", "SEC-1", { set: { note: "paid" } }, admin);
    const raw = await db.findOne("SecretDoc", "SEC-1", "app");
    expect([raw?.["note"], raw?.["secret"]]).toEqual(["paid", stored]);
  });

  it("PLANTED INNOCENT: refuses the patch when no password is stored", async () => {
    await plant("SEC-2");
    await expect(docService.updateSubmitted("SecretDoc", "SEC-2", { set: { note: "paid" } }, admin)).rejects.toBeInstanceOf(ValidationFailedError);
  });
});
