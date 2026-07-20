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
import { WorkflowEngine } from "../src/core/workflow/workflow-engine.js";
import { ViewLogService } from "../src/core/version/view-log-service.js";
import { ActivityLogService } from "../src/core/logging/activity-log-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { PeriodCloseValidator } from "../src/core/period/period-close-validator.js";
import {
  DocumentService,
  CancelBlockedError,
  LinkTargetCancelledError,
} from "../src/core/document/document-service.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

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

/** Submittable upstream entity — the doc that gets cancelled. */
function upstreamEntity(): EntityDefinition {
  return {
    name: "Upstream",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "UP-", pad_length: 4 },
    is_submittable: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
    ],
    permissions: [fullPerms],
  } as unknown as EntityDefinition;
}

/** Submittable downstream entity — links to an Upstream via a top-level Link. */
function downstreamEntity(): EntityDefinition {
  return {
    name: "Downstream",
    module: "test",
    database: "app" as const,
    naming: { strategy: "auto_increment", prefix: "DN-", pad_length: 4 },
    is_submittable: true,
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title", required: true },
      { fieldname: "up", fieldtype: "Link", label: "Upstream", target: "Upstream" },
    ],
    permissions: [fullPerms],
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
  // The write-guard collection is touched INSIDE transactions, which cannot
  // create a collection — it must exist up front (boot ensures it in prod).
  await db.ensureCollection("_doc_guards", "core");
  await db.ensureCollection("_versions", "audits");
  await db.ensureCollection("_view_logs", "logs");
  await db.ensureCollection("Log", "logs");

  registry = new EntityRegistry();
  const permissionChecker = new PermissionChecker(registry);
  hookRunner = new HookRunner();
  hookRunner.setServices({ db, registry });
  const linkValidator = new LinkValidator(registry, db);
  const linkTitleResolver = new LinkTitleResolver(registry, db, new TranslationService(db));
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

  registry.register(upstreamEntity());
  registry.register(downstreamEntity());
  await db.ensureCollection("Upstream", "app");
  await db.ensureCollection("Downstream", "app");
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

// ─── B3 — cancel/submit write-skew guard (_doc_guards) ───────────────────────

describe("cancel/submit write-skew guard (_doc_guards)", () => {
  it("refuses to submit a Downstream whose Link target has been cancelled (LinkTargetCancelledError)", async () => {
    // U is submitted, then cancelled while nothing references it → cancel succeeds.
    const uid = await insertSubmitted("Upstream", { title: "U-dead" });
    await docService.cancel("Upstream", uid, admin);
    const rawU = await db.findOne("Upstream", uid, "app");
    expect(rawU?.["docstatus"]).toBe(2);

    // Insert (draft) still passes link validation — the doc EXISTS, it's just dead.
    const d = await docService.insert("Downstream", { title: "D-late", up: uid }, admin);

    // The submit-side guard re-reads the target under the tx session and refuses.
    await expect(docService.submit("Downstream", d._id, admin)).rejects.toBeInstanceOf(
      LinkTargetCancelledError,
    );
    const rawD = await db.findOne("Downstream", d._id, "app");
    expect(rawD?.["docstatus"]).toBe(0); // nothing flipped
  });

  it("submit of a Downstream touches the upstream's guard entry in _doc_guards (CORE)", async () => {
    const uid = await insertSubmitted("Upstream", { title: "U-live" });
    await insertSubmitted("Downstream", { title: "D-forward", up: uid });

    const guard = await db.findOne("_doc_guards", `Upstream:${uid}`, "core");
    expect(guard).toBeTruthy();
    expect(guard?.["_id"]).toBe(`Upstream:${uid}`);
    expect(Number(guard?.["v"])).toBeGreaterThanOrEqual(1);
  });

  it("cancel touches the cancelled doc's own guard entry in _doc_guards", async () => {
    const uid = await insertSubmitted("Upstream", { title: "U-cx" });
    await docService.cancel("Upstream", uid, admin);

    const guard = await db.findOne("_doc_guards", `Upstream:${uid}`, "core");
    expect(guard).toBeTruthy();
    expect(guard?.["_id"]).toBe(`Upstream:${uid}`);
    expect(Number(guard?.["v"])).toBeGreaterThanOrEqual(1);
  });

  it("forward-immutability still holds: cancelling an Upstream with a SUBMITTED Downstream is blocked", async () => {
    const uid = await insertSubmitted("Upstream", { title: "U-held" });
    await insertSubmitted("Downstream", { title: "D-holds", up: uid });

    await expect(docService.cancel("Upstream", uid, admin)).rejects.toBeInstanceOf(
      CancelBlockedError,
    );
    const rawU = await db.findOne("Upstream", uid, "app");
    expect(rawU?.["docstatus"]).toBe(1); // still submitted
  });

  it("touchGuard on the SAME key from two overlapping transactions raises a transient write conflict", async () => {
    const client = db.getClient();

    // Seed the guard doc OUTSIDE any transaction so both transactions perform a
    // plain update (a clean document-level write conflict, not an upsert-insert).
    const seed = client.startSession();
    try {
      await db.touchGuard("RaceKey:1", seed);
    } finally {
      await seed.endSession();
    }

    const sessionA = client.startSession();
    const sessionB = client.startSession();
    try {
      sessionA.startTransaction();
      sessionB.startTransaction();

      // A touches the guard first and holds the uncommitted write intent.
      await db.touchGuard("RaceKey:1", sessionA);

      // B touching the SAME guard doc must collide: MongoDB aborts B's write
      // with a WriteConflict labelled TransientTransactionError (this is the
      // retry signal the production withTransaction wrapper acts on).
      let conflict: unknown;
      try {
        await db.touchGuard("RaceKey:1", sessionB);
        await sessionB.commitTransaction();
      } catch (err) {
        conflict = err;
      }

      // A's transaction is unaffected and commits.
      await sessionA.commitTransaction();

      expect(conflict).toBeDefined();
      const labels = (conflict as { errorLabels?: string[] }).errorLabels ?? [];
      expect(labels).toContain("TransientTransactionError");
    } finally {
      await Promise.allSettled([sessionA.abortTransaction(), sessionB.abortTransaction()]);
      await sessionA.endSession();
      await sessionB.endSession();
    }
  });
});
