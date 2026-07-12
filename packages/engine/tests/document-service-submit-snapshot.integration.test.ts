import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
    MODULES_DIR: "./src/modules", TRANSLATION_SOURCE: "file", TRANSLATION_FALLBACK_LOCALE: "en",
  },
}));
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
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { SnapshotResolver, SnapshotMissingTargetError } from "../src/core/snapshot/snapshot-resolver.js";
import { DocStatusError } from "../src/core/document/docstatus-engine.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;

const adminUser: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin User",
};

function customerEntity(): EntityDefinition {
  return {
    name: "customer",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    is_submittable: false,
    track_changes: false,
    fields: [
      { fieldname: "company_name", fieldtype: "Data", label: "Company", required: true },
      { fieldname: "vat_id", fieldtype: "Data", label: "VAT" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    ],
  } as unknown as EntityDefinition;
}

function productEntity(): EntityDefinition {
  return {
    name: "product",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    is_submittable: false,
    track_changes: false,
    fields: [
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
      { fieldname: "product_number", fieldtype: "Data", label: "Number" },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
    ],
  } as unknown as EntityDefinition;
}

function invoiceEntity(): EntityDefinition {
  return {
    name: "salesInvoice",
    module: "test",
    database: "app",
    naming: { strategy: "auto_increment", prefix: "INV-", pad_length: 4 },
    is_submittable: true,
    track_changes: false,
    snapshot: [
      {
        from: "customer",
        fields: { customer_company_name: "company_name", customer_vat_id: "vat_id" },
      },
    ],
    fields: [
      { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", required: true },
      { fieldname: "customer_company_name", fieldtype: "Data", label: "Customer Name (Snapshot)", read_only: true },
      { fieldname: "customer_vat_id", fieldtype: "Data", label: "VAT ID (Snapshot)", read_only: true },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        snapshot: [
          { from: "product", fields: { product_name_snapshot: "name", product_number_snapshot: "product_number" } },
        ],
        child_fields: [
          { fieldname: "product", fieldtype: "Link", label: "Product", target: "product", required: true },
          { fieldname: "qty", fieldtype: "Float", label: "Qty" },
          { fieldname: "product_name_snapshot", fieldtype: "Data", label: "Product Name (Snapshot)", read_only: true },
          { fieldname: "product_number_snapshot", fieldtype: "Data", label: "Product Number (Snapshot)", read_only: true },
        ],
      },
    ],
    permissions: [
      { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
    ],
  } as unknown as EntityDefinition;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();

  await db.ensureCollection("_sequences", "app");
  await db.ensureCollection("_sequences", "core");
  await db.ensureCollection("_doc_guards", "core");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");
  await db.ensureCollection("customer", "app");
  await db.ensureCollection("product", "app");
  await db.ensureCollection("salesInvoice", "app");

  registry = new EntityRegistry();
  registry.register(customerEntity());
  registry.register(productEntity());
  registry.register(invoiceEntity());

  const permissionChecker = new PermissionChecker(registry);
  const hookRunner = new HookRunner();
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db));
  const fetchFromResolver = new FetchFromResolver(registry, db);
  const snapshotResolver = new SnapshotResolver(registry, db);
  const deleteProtection = new DeleteProtection(registry, db);
  const cancelProtection = new CancelProtection(registry, db);
  const versionService = new VersionService(db);
  const viewLogService = new ViewLogService(db);
  const activityLogService = new ActivityLogService(db);
  const translationService = new TranslationService(db);

  docService = new DocumentService({
    registry, db, permissionChecker, hookRunner,
    linkValidator, linkTitleResolver, fetchFromResolver, snapshotResolver,
    deleteProtection, cancelProtection, versionService, viewLogService, activityLogService, translationService,
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("DocumentService submit + snapshot integration", () => {
  let invoiceId: string;

  beforeEach(async () => {
    // Clear collections between tests for isolation.
    await db.deleteMany("salesInvoice", {}, "app");
    await db.deleteMany("customer", {}, "app");
    await db.deleteMany("product", {}, "app");
  });

  it("freezes customer + product values on submit; live mutations don't change submitted invoice", async () => {
    await docService.insert("customer", { _id: "CUST-1", company_name: "Acme GmbH", vat_id: "DE123" }, adminUser);
    await docService.insert("product",  { _id: "PROD-A", name: "Widget", product_number: "W-001" }, adminUser);

    const draft = await docService.insert(
      "salesInvoice",
      { customer: "CUST-1", lines: [{ product: "PROD-A", qty: 2 }] },
      adminUser,
    );
    invoiceId = draft._id;

    // Draft → snapshot fields not yet populated.
    expect(draft.get("customer_company_name")).toBeUndefined();

    const submitted = await docService.submit("salesInvoice", invoiceId, adminUser);
    expect(submitted.get("customer_company_name")).toBe("Acme GmbH");
    expect(submitted.get("customer_vat_id")).toBe("DE123");
    const lines = submitted.get("lines") as Array<Record<string, unknown>>;
    expect(lines[0]!["product_name_snapshot"]).toBe("Widget");
    expect(lines[0]!["product_number_snapshot"]).toBe("W-001");

    // Mutate the live customer + product. The submitted invoice must NOT change.
    await docService.update("customer", "CUST-1", { company_name: "Acme AG" }, adminUser);
    await docService.update("product",  "PROD-A", { name: "Widget v2" }, adminUser);

    const reloaded = await docService.getDoc("salesInvoice", invoiceId, adminUser);
    expect(reloaded.get("customer_company_name")).toBe("Acme GmbH");
    const reloadedLines = reloaded.get("lines") as Array<Record<string, unknown>>;
    expect(reloadedLines[0]!["product_name_snapshot"]).toBe("Widget");
  });

  it("blocks PUT on a submitted invoice (validateEdit guard)", async () => {
    await docService.insert("customer", { _id: "CUST-2", company_name: "X", vat_id: "x" }, adminUser);
    await docService.insert("product",  { _id: "PROD-B", name: "Y", product_number: "y" }, adminUser);
    const draft = await docService.insert(
      "salesInvoice",
      { customer: "CUST-2", lines: [{ product: "PROD-B", qty: 1 }] },
      adminUser,
    );
    await docService.submit("salesInvoice", draft._id, adminUser);
    await expect(
      docService.update("salesInvoice", draft._id, { customer_company_name: "tampered" }, adminUser),
    ).rejects.toBeInstanceOf(DocStatusError);
  });

  it("rolls back the snapshot when submit fails after it (transaction integrity)", async () => {
    await docService.insert("customer", { _id: "CUST-3", company_name: "Z", vat_id: "z" }, adminUser);
    await docService.insert("product",  { _id: "PROD-C", name: "Q", product_number: "q" }, adminUser);
    const draft = await docService.insert(
      "salesInvoice",
      { customer: "CUST-3", lines: [{ product: "PROD-C", qty: 1 }] },
      adminUser,
    );
    // Force submit to throw AFTER snapshot has populated by mocking docStatusEngine via spying on db.updateOne.
    const originalUpdate = db.updateOne.bind(db);
    const spy = vi.spyOn(db, "updateOne").mockImplementationOnce(async () => {
      throw new Error("simulated write failure");
    });
    await expect(docService.submit("salesInvoice", draft._id, adminUser)).rejects.toThrow();
    spy.mockRestore();
    void originalUpdate;

    // The submitted invoice must remain in draft state with NO snapshot persisted.
    const reloaded = await docService.getDoc("salesInvoice", draft._id, adminUser);
    expect(reloaded.docstatus).toBe(0);
    expect(reloaded.get("customer_company_name")).toBeUndefined();
  });

  it("aborts submit when the Link target is missing", async () => {
    await docService.insert("customer", { _id: "CUST-4", company_name: "K", vat_id: "k" }, adminUser);
    await docService.insert("product",  { _id: "PROD-D", name: "P", product_number: "p" }, adminUser);
    const draft = await docService.insert(
      "salesInvoice",
      { customer: "CUST-4", lines: [{ product: "PROD-D", qty: 1 }] },
      adminUser,
    );

    // Now wipe the customer behind link-validation (raw delete bypasses delete-protection).
    await db.deleteOne("customer", "CUST-4", "app");

    await expect(docService.submit("salesInvoice", draft._id, adminUser)).rejects.toBeInstanceOf(
      SnapshotMissingTargetError,
    );

    // Ensure the doc is still a draft.
    const reloaded = await docService.getDoc("salesInvoice", draft._id, adminUser);
    expect(reloaded.docstatus).toBe(0);
  });
});
