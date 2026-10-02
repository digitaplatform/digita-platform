import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test", MODULES_DIR: "./src/modules", TRANSLATION_SOURCE: "file", TRANSLATION_FALLBACK_LOCALE: "en" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
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
import { WorkflowEngine } from "../src/core/workflow/workflow-engine.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { seedLanguages, fillLanguageCodesOnce } from "../src/core/setup/seed-languages.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

const admin: UserContext = { _id: "admin-1", email: "admin@test.local", roles: [SYSTEM_ROLES.ADMINISTRATOR], full_name: "Admin" };

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let docService: DocumentService;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  for (const [name, target] of [["_sequences", "core"], ["_doc_guards", "core"], ["_sequences", "logs"], ["_versions", "audits"], ["_view_logs", "logs"], ["Log", "logs"]] as const) {
    await db.ensureCollection(name, target);
  }
  const registry = new EntityRegistry();
  await registry.loadAll("./src/entities");
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
    workflowEngine: new WorkflowEngine(),
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a seeded Language", () => {
  it("carries its code, so an Administrator can save it", async () => {
    await seedLanguages(db);
    await docService.update("Language", "de", { enabled: false }, admin);
    const stored = await db.findOne(DIGITA.COLLECTIONS.LANGUAGE, "de", DIGITA.DATABASES.CORE);
    expect([stored?.["code"], stored?.["enabled"]]).toEqual(["de", false]);
  });

  it("gets the code a seed before this release left out, once per database", async () => {
    const languages = db.collection(DIGITA.COLLECTIONS.LANGUAGE, DIGITA.DATABASES.CORE);
    await db.collection("_migrations", DIGITA.DATABASES.CORE).deleteMany({});
    await languages.updateOne({ _id: "fr" as never }, { $unset: { code: "" } });
    await fillLanguageCodesOnce(db);
    expect((await db.findOne(DIGITA.COLLECTIONS.LANGUAGE, "fr", DIGITA.DATABASES.CORE))?.["code"]).toBe("fr");

    await languages.updateOne({ _id: "es" as never }, { $set: { code: "" } });
    await fillLanguageCodesOnce(db);
    expect((await db.findOne(DIGITA.COLLECTIONS.LANGUAGE, "es", DIGITA.DATABASES.CORE))?.["code"]).toBe("");
  });
});
