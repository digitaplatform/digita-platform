import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

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
  for (const [name, target] of [["_sequences", "app"], ["_sequences", "core"], ["_doc_guards", "core"], ["_sequences", "logs"], ["_versions", "audits"], ["_view_logs", "logs"], ["Log", "logs"], ["ResetDraft", "app"], ["ResetBook", "app"], ["ResetInvoice", "app"], ["CoreNote", "core"]] as const) {
    await db.ensureCollection(name, target);
  }
  registry = new EntityRegistry();
  // Registered first, so the reset wipes it first: a commit that lands after the wipe began survives it.
  registry.register({ ...entity("ResetDraft", "app", true), naming: { strategy: "system" } } as unknown as EntityDefinition);
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

/** Whether `promise` has settled within `ms`. */
const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

describe("an action on the app's entity while its demo reset runs", () => {
  /** Per order: the book its action inserts, and whether the action then waits to be released. */
  const plans = new Map<string, { book: string; wrote: () => void; held: Promise<void> }>();
  /** Plans the action of `order`: it inserts `book` in its transaction, signals, and waits until released. */
  function planAction(order: string, book: string) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let wrote!: () => void;
    const written = new Promise<void>((resolve) => (wrote = resolve));
    plans.set(order, { book, wrote, held });
    return { release, written };
  }

  beforeAll(async () => {
    registry.register({ ...entity("ResetOrder", "app"), actions: [{ action: "spawn", label: "Spawn" }] } as unknown as EntityDefinition);
    registry.register({ ...entity("CoreNote", "core"), actions: [{ action: "reset", label: "Reset" }] } as unknown as EntityDefinition);
    await db.ensureCollection("ResetOrder", "app");
    hookRunner.setServices({ db, registry } as never);
    hookRunner.registerAction("ResetOrder", "spawn", (async (doc: { _id: string }, _ctx: unknown, services: { session?: never }) => {
      const plan = plans.get(doc._id)!;
      await docService.insert("ResetBook", { _id: plan.book, title: "Written by an action" }, admin, undefined, services.session);
      plan.wrote();
      // A handler goes on after its last write, here until the test releases it.
      await plan.held;
      return "done";
    }) as never);
    // The demo reset itself runs inside an action of a core entity.
    hookRunner.registerAction("CoreNote", "reset", (async () => reseedAppData("template", deps())) as never);
  });

  beforeEach(async () => {
    await db.deleteMany("ResetBook", {}, "app");
    await db.deleteMany("ResetOrder", {}, "app");
    plans.clear();
  });

  it("PLANTED DEFECT: waits until the action's transaction commits, so the wipe removes what it wrote", async () => {
    await docService.insert("ResetOrder", { _id: "OR-1", title: "Order" }, admin);
    const { release, written } = planAction("OR-1", "BK-ACTION");
    const action = docService.runAction("ResetOrder", "OR-1", "spawn", admin);
    await written;
    const reset = reseedAppData("template", deps());
    expect(await settledWithin(reset, 300)).toBe(false);
    release();
    await action;
    await reset;
    expect((await db.find("ResetBook", {}, "app")).map((b) => [b["_id"], b["title"]])).toEqual([["BK-1", "Seeded"]]);
  }, 60000);

  it("lets the seed write a seeded id that an action took before the reset", async () => {
    await docService.insert("ResetOrder", { _id: "OR-2", title: "Order" }, admin);
    const { release, written } = planAction("OR-2", "BK-1");
    const action = docService.runAction("ResetOrder", "OR-2", "spawn", admin);
    await written;
    const reset = reseedAppData("template", deps());
    release();
    await action;
    await reset;
    expect((await db.find("ResetBook", {}, "app")).map((b) => [b["_id"], b["title"]])).toEqual([["BK-1", "Seeded"]]);
  }, 60000);

  it("waits for two actions until the second has ended", async () => {
    await docService.insert("ResetOrder", { _id: "OR-A", title: "Order" }, admin);
    await docService.insert("ResetOrder", { _id: "OR-B", title: "Order" }, admin);
    const first = planAction("OR-A", "BK-A");
    const second = planAction("OR-B", "BK-B");
    const actions = [docService.runAction("ResetOrder", "OR-A", "spawn", admin), docService.runAction("ResetOrder", "OR-B", "spawn", admin)];
    await Promise.all([first.written, second.written]);
    const reset = reseedAppData("template", deps());
    first.release();
    await actions[0];
    expect(await settledWithin(reset, 300)).toBe(false);
    second.release();
    await actions[1];
    await reset;
    expect((await db.find("ResetBook", {}, "app")).map((b) => b["_id"])).toEqual(["BK-1"]);
  }, 60000);

  it("refuses an action that begins while the reset runs", async () => {
    await docService.insert("ResetOrder", { _id: "OR-3", title: "Order" }, admin);
    planAction("OR-3", "BK-LATE");
    const during = duringTheWipe(() => Promise.all([outcome(docService.runAction("ResetOrder", "OR-3", "spawn", admin))]));
    await reseedAppData("template", deps());
    expect(during()).toEqual(["refused reseed_write_refused ResetOrder template"]);
  }, 60000);

  it("PLANTED INNOCENT: runs the reset from an action of a core entity without waiting for itself", async () => {
    await docService.insert("CoreNote", { _id: "N-RESET", title: "Reset" }, admin);
    const run = docService.runAction("CoreNote", "N-RESET", "reset", admin);
    expect(await settledWithin(run, 20000)).toBe(true);
    await expect(run).resolves.toMatchObject({ mode: "template" });
  }, 60000);
});

describe("a copy or an amendment in flight when the demo reset starts", () => {
  const hooks = () => (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks;
  /** Starts `write` and holds it in its validate hook, inside its transaction, until released. */
  async function holdInValidate(write: () => Promise<unknown>) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inHook = new Promise<void>((resolve) => (entered = resolve));
    hooks().set("ResetDraft", new Map([["validate", async () => { entered(); await held; }]]));
    const running = write();
    await inHook;
    hooks().delete("ResetDraft");
    return { running, release };
  }

  beforeEach(async () => {
    await db.deleteMany("ResetDraft", {}, "app");
  });

  it("PLANTED DEFECT: waits for a copy until it commits, so the wipe removes it", async () => {
    const source = await docService.insert("ResetDraft", { title: "Source" }, admin);
    const { running, release } = await holdInValidate(() => docService.copyDoc("ResetDraft", String(source._id), admin));
    const reset = reseedAppData("template", deps());
    release();
    await running;
    await reset;
    expect(await db.find("ResetDraft", {}, "app")).toEqual([]);
  }, 60000);

  it("waits for an amendment until it commits, so the wipe removes it", async () => {
    const source = await docService.insert("ResetDraft", { title: "Source" }, admin);
    await docService.submit("ResetDraft", String(source._id), admin);
    await docService.cancel("ResetDraft", String(source._id), admin);
    const { running, release } = await holdInValidate(() => docService.amend("ResetDraft", String(source._id), admin));
    const reset = reseedAppData("template", deps());
    release();
    await running;
    await reset;
    expect(await db.find("ResetDraft", {}, "app")).toEqual([]);
  }, 60000);
});
