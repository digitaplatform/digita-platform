// A view's list and link sections answer a translatable field in the reader's language, as a
// document read does, and the stored text where no translation or no locale exists.
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test", MODULES_DIR: "./src/modules", TRANSLATION_SOURCE: "file", TRANSLATION_FALLBACK_LOCALE: "en" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { createReplicaFixture, type ReplicaFixture } from "./cloud-mongo.js";
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
import { DocumentShareService } from "../src/core/permissions/document-share-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { DIGITA, SYSTEM_ROLES } from "@digitaplatform/shared";
import { ResponseContext } from "../src/core/api/response-context.js";
import { runListSection } from "../src/core/view/section-runners/list-section.js";
import { runLinkSection } from "../src/core/view/section-runners/link-section.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

let replSet: ReplicaFixture;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;

const adminUser: UserContext = {
  _id: "admin-001",
  email: "admin@test.local",
  roles: [SYSTEM_ROLES.ADMINISTRATOR],
  full_name: "Admin User",
};

const FULL_PERMS = [
  { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
];

const customerEntity = {
  name: "LtCustomer",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "company_name",
  fields: [{ fieldname: "company_name", fieldtype: "Data", label: "Company", required: true, translatable: true }],
  permissions: FULL_PERMS,
} as unknown as EntityDefinition;

const orderEntity = {
  name: "LtOrder",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "LT-", pad_length: 4 },
  fields: [
    { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "LtCustomer" },
    { fieldname: "note", fieldtype: "Data", label: "Note" },
  ],
  permissions: FULL_PERMS,
} as unknown as EntityDefinition;

// The write paths answer link titles in the caller's locale, as a read does.
const invoiceEntity = {
  name: "LtInvoice",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "LI-", pad_length: 4 },
  is_submittable: true,
  fields: [{ fieldname: "customer", fieldtype: "Link", label: "Customer", target: "LtCustomer" }],
  permissions: FULL_PERMS,
} as unknown as EntityDefinition;

beforeAll(async () => {
  replSet = await createReplicaFixture({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_sequences", "app");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");

  registry = new EntityRegistry();
  const permissionChecker = new PermissionChecker(registry);
  const translationService = new TranslationService(db);
  docService = new DocumentService({
    tenantTimeZone: () => "UTC",
    registry,
    db,
    permissionChecker,
    hookRunner: new HookRunner(),
    linkValidator: new LinkValidator(registry, db, permissionChecker),
    linkTitleResolver: new LinkTitleResolver(registry, db, translationService, permissionChecker),
    fetchFromResolver: new FetchFromResolver(registry, db),
    deleteProtection: new DeleteProtection(registry, db),
    cancelProtection: new CancelProtection(registry, db),
    versionService: new VersionService(db),
    viewLogService: new ViewLogService(db),
    activityLogService: new ActivityLogService(db),
    translationService,
    documentShareService: new DocumentShareService(db),
  } as unknown as ConstructorParameters<typeof DocumentService>[0]);

  registry.register(customerEntity);
  registry.register(orderEntity);
  registry.register(invoiceEntity);
  await db.ensureCollection("LtCustomer", "app");
  await db.ensureCollection("LtOrder", "app");
  await db.ensureCollection("LtInvoice", "app");
  await db.ensureCollection(DIGITA.COLLECTIONS.TRANSLATION, DIGITA.DATABASES.CORE);
  await docService.insert("LtCustomer", { _id: "CUST-1", company_name: "Acme GmbH" }, adminUser);
  const now = new Date();
  await db.insertOne(
    DIGITA.COLLECTIONS.TRANSLATION,
    {
      _id: "data:en:LtCustomer.CUST-1.company_name", namespace: "data", locale: "en", key: "LtCustomer.CUST-1.company_name",
      value: "Acme Ltd", entity: "LtCustomer", document_name: "CUST-1", fieldname: "company_name", source: "file",
      overridden: false, owner: "system", modified_by: "system", creation: now, modified: now,
    },
    DIGITA.DATABASES.CORE,
  );
}, 120000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);


const rctx = { root: null, user: adminUser, params: {}, now: new Date(), warnings: [] } as never;
const deps = () => ({ documentService: docService, permissionChecker: (docService as unknown as { permissionChecker: unknown }).permissionChecker }) as never;

describe("a view section's translatable field", () => {
  it("answers a list section in the reader's language", async () => {
    const rows = await runListSection({ key: "c", kind: "list", entity: "LtCustomer" } as never, rctx, adminUser, new ResponseContext("en"), deps());
    expect(rows.find((r) => r["_id"] === "CUST-1")?.["company_name"]).toBe("Acme Ltd");
  });

  it("answers a link section in the reader's language", async () => {
    const doc = await runLinkSection({ key: "c", kind: "link", entity: "LtCustomer", target: "CUST-1" } as never, rctx, adminUser, new ResponseContext("en"), deps());
    expect(doc?.["company_name"]).toBe("Acme Ltd");
  });

  it("answers the stored text without a locale, and in a language without a translation", async () => {
    const list = await runListSection({ key: "c", kind: "list", entity: "LtCustomer" } as never, rctx, adminUser, new ResponseContext(), deps());
    expect(list.find((r) => r["_id"] === "CUST-1")?.["company_name"]).toBe("Acme GmbH");
    const link = await runLinkSection({ key: "c", kind: "link", entity: "LtCustomer", target: "CUST-1" } as never, rctx, adminUser, new ResponseContext("fr"), deps());
    expect(link?.["company_name"]).toBe("Acme GmbH");
  });
});
