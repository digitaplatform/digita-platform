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
const entity = (name: string, database: string, is_submittable = false) =>
  ({
    name, module: "test", database, naming: { strategy: "user_set" }, is_submittable,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "paid", fieldtype: "Currency", label: "Paid", allow_on_submit: true },
    ],
    permissions: [{ ...PERMS[0], submit: 1, cancel: 1 }],
  }) as unknown as EntityDefinition;

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let docService: DocumentService;
let translationService: TranslationService;
let hookRunner: HookRunner;
let app: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  // The app database the reset wipes, under the name every other test reaches it by.
  db.registerAppDatabase({ name: "app", label: "App" });
  for (const [name, target] of [["_sequences", "app"], ["_sequences", "core"], ["_doc_guards", "core"], ["_sequences", "logs"], ["_versions", "audits"], ["_view_logs", "logs"], ["Log", "logs"], ["ResetBook", "app"], ["ResetInvoice", "app"], ["CoreNote", "core"]] as const) {
    await db.ensureCollection(name, target);
  }
  registry = new EntityRegistry();
  registry.register(entity("ResetBook", "app"));
  registry.register(entity("CoreNote", "core"));
  registry.register(entity("ResetInvoice", "app", true));
  hookRunner = new HookRunner();
  const permissionChecker = new PermissionChecker(registry);
  translationService = new TranslationService(db);
  docService = new DocumentService({
    tenantTimeZone: () => "UTC",
    registry,
    db,
    permissionChecker,
    hookRunner,
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

const deps = () => ({ db, registry, translationService, appDirs: [app], getDomainDirs: () => [] });
const outcome = (write: Promise<unknown>) =>
  write.then(
    () => "stored",
    (err: unknown) =>
      err instanceof ReseedWriteRefusedError ? `refused ${err.code} ${err.params.doctype} ${err.params.running}` : `failed: ${String(err)}`,
  );
/** Runs `writes` while the reset wipes, which is when one would survive or take a seeded id. */
function duringTheWipe(writes: () => Promise<string[]>): () => string[] {
  let during: string[] = [];
  const wipe = db.deleteMany.bind(db);
  vi.spyOn(db, "deleteMany").mockImplementationOnce(async (...args: Parameters<MongoDBService["deleteMany"]>) => {
    during = await writes();
    return wipe(...args);
  });
  return () => during;
}

describe("a write to the app while its demo reset runs", () => {
  it("is refused naming the running reset, the seeded ids stay intact, and a core write goes on", async () => {
    await docService.insert("ResetBook", { _id: "BK-OLD", title: "Before" }, admin);
    const during = duringTheWipe(() =>
      Promise.all([
        outcome(docService.insert("ResetBook", { _id: "BK-1", title: "Taken during the reset" }, admin)),
        outcome(docService.update("ResetBook", "BK-OLD", { title: "Changed during the reset" }, admin)),
        outcome(docService.deleteDoc("ResetBook", "BK-OLD", admin)),
        outcome(docService.insert("CoreNote", { _id: "N-1", title: "Kept" }, admin)),
      ]),
    );

    await reseedAppData("template", deps());

    const refused = "refused reseed_write_refused ResetBook template";
    expect(during()).toEqual([refused, refused, refused, "stored"]);
    const books = await db.find("ResetBook", {}, "app");
    expect(books.map((b) => [b["_id"], b["title"]])).toEqual([["BK-1", "Seeded"]]);
    await expect(docService.insert("ResetBook", { _id: "BK-2", title: "After" }, admin)).resolves.toBeDefined();
  }, 60000);

  it("refuses a submit, a cancel and a submitted patch", async () => {
    await docService.insert("ResetInvoice", { _id: "IN-DRAFT", title: "Draft" }, admin);
    await docService.insert("ResetInvoice", { _id: "IN-SUB", title: "Submitted" }, admin);
    await docService.submit("ResetInvoice", "IN-SUB", admin);
    await docService.insert("ResetInvoice", { _id: "IN-PAID", title: "Submitted" }, admin);
    await docService.submit("ResetInvoice", "IN-PAID", admin);
    const during = duringTheWipe(() =>
      Promise.all([
        outcome(docService.submit("ResetInvoice", "IN-DRAFT", admin)),
        outcome(docService.cancel("ResetInvoice", "IN-SUB", admin)),
        outcome(docService.updateSubmitted("ResetInvoice", "IN-PAID", { set: { paid: 5 } }, admin)),
      ]),
    );

    await reseedAppData("template", deps());

    const refused = "refused reseed_write_refused ResetInvoice template";
    expect(during()).toEqual([refused, refused, refused]);
  }, 60000);

  it("waits for a write that began before the reset, so the wipe removes it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inHook = new Promise<void>((resolve) => (entered = resolve));
    (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set(
      "ResetBook",
      new Map([["validate", async () => { entered(); await held; }]]),
    );
    try {
      const early = outcome(docService.insert("ResetBook", { _id: "BK-EARLY", title: "Started before the reset" }, admin));
      await inHook;
      const reset = reseedAppData("template", deps());
      // The reset is marked, so a new write is refused while the early one still runs.
      expect(await outcome(docService.insert("ResetBook", { _id: "BK-LATE", title: "Late" }, admin))).toBe(
        "refused reseed_write_refused ResetBook template",
      );
      release();
      expect(await early).toBe("stored");
      await reset;
    } finally {
      (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("ResetBook");
    }
    const books = await db.find("ResetBook", {}, "app");
    expect(books.map((b) => b["_id"])).toEqual(["BK-1"]);
  }, 60000);
});
