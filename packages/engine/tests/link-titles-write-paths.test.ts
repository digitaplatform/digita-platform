// _link_titles on the WRITE paths: create/update/preview responses must carry
// the resolved link display titles. They used to be resolved only in getDoc/
// getList — after a save the form reset to a doc WITHOUT titles and every Link
// field regressed to its raw id until a full reload.
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
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { DocumentShareService } from "../src/core/permissions/document-share-service.js";
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

const FULL_PERMS = [
  { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1, submit: 1, cancel: 1, amend: 1 },
];

const customerEntity = {
  name: "LtCustomer",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "company_name",
  fields: [{ fieldname: "company_name", fieldtype: "Data", label: "Company", required: true }],
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

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
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
    registry,
    db,
    permissionChecker,
    hookRunner: new HookRunner(),
    linkValidator: new LinkValidator(registry, db),
    linkTitleResolver: new LinkTitleResolver(registry, db, translationService),
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
  await db.ensureCollection("LtCustomer", "app");
  await db.ensureCollection("LtOrder", "app");
  await docService.insert("LtCustomer", { _id: "CUST-1", company_name: "Acme GmbH" }, adminUser);
}, 120000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("_link_titles on write paths", () => {
  it("insert response carries the resolved link title", async () => {
    const doc = await docService.insert("LtOrder", { customer: "CUST-1" }, adminUser);
    const json = doc.toJSON() as Record<string, unknown>;
    expect((json["_link_titles"] as Record<string, string>)?.customer).toBe("Acme GmbH");
  });

  it("update response carries the resolved link title", async () => {
    const created = await docService.insert("LtOrder", { customer: "CUST-1" }, adminUser);
    const updated = await docService.update("LtOrder", created._id, { note: "changed" }, adminUser);
    const json = updated.toJSON() as Record<string, unknown>;
    expect((json["_link_titles"] as Record<string, string>)?.customer).toBe("Acme GmbH");
  });

  it("preview response carries the resolved link title", async () => {
    const doc = await docService.preview("LtOrder", { customer: "CUST-1" }, adminUser);
    const json = doc.toJSON() as Record<string, unknown>;
    expect((json["_link_titles"] as Record<string, string>)?.customer).toBe("Acme GmbH");
  });
});
