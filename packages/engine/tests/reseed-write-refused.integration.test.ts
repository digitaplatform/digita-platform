import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test", MODULES_DIR: "./src/modules", TRANSLATION_SOURCE: "file", TRANSLATION_FALLBACK_LOCALE: "en" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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
import { WorkflowEngine } from "../src/core/workflow/workflow-engine.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { DocumentService } from "../src/core/document/document-service.js";
import { reseedAppData } from "../src/core/setup/reseed-app-data.js";
import { ReseedWriteRefusedError } from "../src/core/setup/reseed-lock.js";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

const admin: UserContext = { _id: "admin-1", email: "admin@test.local", roles: [SYSTEM_ROLES.ADMINISTRATOR], full_name: "Admin" };
const PERMS = [{ role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 }];
const entity = (name: string, database: string) =>
  ({
    name, module: "test", database, naming: { strategy: "user_set" }, is_submittable: false,
    fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }], permissions: PERMS,
  }) as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;
let translationService: TranslationService;
let app: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  // The app database the reset wipes, under the name every other test reaches it by.
  db.registerAppDatabase({ name: "app", label: "App" });
  for (const [name, target] of [["_sequences", "app"], ["_sequences", "core"], ["_doc_guards", "core"], ["_sequences", "logs"], ["_versions", "audits"], ["_view_logs", "logs"], ["Log", "logs"], ["ResetBook", "app"], ["CoreNote", "core"]] as const) {
    await db.ensureCollection(name, target);
  }
  registry = new EntityRegistry();
  registry.register(entity("ResetBook", "app"));
  registry.register(entity("CoreNote", "core"));
  const permissionChecker = new PermissionChecker(registry);
  translationService = new TranslationService(db);
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
  app = await mkdtemp(join(tmpdir(), "reseed-write-refused-"));
  await mkdir(join(app, "seeds"));
  await writeFile(join(app, "seeds", "ResetBook.seed.json"), JSON.stringify([{ _id: "BK-1", title: "Seeded" }]));
}, 60000);

afterAll(async () => {
  await rm(app, { recursive: true, force: true });
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("a write to the app while its demo reset runs", () => {
  it("is refused naming the running reset, the seeded ids stay intact, and a core write goes on", async () => {
    await docService.insert("ResetBook", { _id: "BK-OLD", title: "Before" }, admin);
    const outcome = (write: Promise<unknown>) =>
      write.then(
        () => "stored",
        (err: unknown) => (err instanceof ReseedWriteRefusedError ? `refused: ${err.message}` : `failed: ${String(err)}`),
      );
    let during: string[] = [];
    // The writes land while the reset wipes, which is when one would survive or take a seeded id.
    const wipe = db.deleteMany.bind(db);
    vi.spyOn(db, "deleteMany").mockImplementationOnce(async (...args: Parameters<MongoDBService["deleteMany"]>) => {
      during = await Promise.all([
        outcome(docService.insert("ResetBook", { _id: "BK-1", title: "Taken during the reset" }, admin)),
        outcome(docService.update("ResetBook", "BK-OLD", { title: "Changed during the reset" }, admin)),
        outcome(docService.deleteDoc("ResetBook", "BK-OLD", admin)),
        outcome(docService.insert("CoreNote", { _id: "N-1", title: "Kept" }, admin)),
      ]);
      return wipe(...args);
    });

    await reseedAppData("template", { db, registry, translationService, appDirs: [app], getDomainDirs: () => [] });

    const refused = "refused: ResetBook cannot be saved while a reset in mode template runs; save again once it has ended";
    expect(during).toEqual([refused, refused, refused, "stored"]);
    const books = await db.find("ResetBook", {}, "app");
    expect(books.map((b) => [b["_id"], b["title"]])).toEqual([["BK-1", "Seeded"]]);
    await expect(docService.insert("ResetBook", { _id: "BK-2", title: "After" }, admin)).resolves.toBeDefined();
  }, 60000);
});
