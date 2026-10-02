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
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { HookRunner, type HookServices } from "../src/core/hooks/hook-runner.js";
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
import { DocumentService, DeleteBlockedError } from "../src/core/document/document-service.js";
import type { BaseDocument } from "../src/core/document/base-document.js";
import type { StoragePort } from "../src/core/storage/storage-port.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES, DIGITA } from "@digitaplatform/shared";
import type { UserContext } from "../src/core/permissions/types.js";
import { env } from "../src/core/config/env.js";

// An action on a Booking that calls the document service with `services.session`
// gets one transaction: every write commits with the action or rolls back with it,
// and every read sees what the action wrote before it.

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let registry: EntityRegistry;
let hookRunner: HookRunner;
let docService: DocumentService;
const deletedBlobs: string[] = [];

const admin: UserContext = { _id: "admin-001", email: "admin@test.local", roles: [SYSTEM_ROLES.ADMINISTRATOR], full_name: "Admin" };
const fullPerms = { role: SYSTEM_ROLES.ADMINISTRATOR, level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 };

const workOrder = {
  name: "WorkOrder",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "WO-", pad_length: 4 },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [fullPerms],
} as unknown as EntityDefinition;

const booking = {
  name: "Booking",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment", prefix: "BK-", pad_length: 4 },
  workflow_field: "status",
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["open", "converted"], default: "open" },
    { fieldname: "work_order", fieldtype: "Link", label: "Work order", target: "WorkOrder" },
    { fieldname: "work_order_title", fieldtype: "Data", label: "Work order title", read_only: true, fetch_from: "work_order.title" },
    { fieldname: "attachment", fieldtype: "Attach", label: "Attachment" },
  ],
  states: [{ value: "open", is_initial: true }, { value: "converted" }],
  transitions: [{ from: "open", to: "converted", action: "convert" }],
  actions: [{ label: "Convert", action: "convert" }],
  permissions: [fullPerms],
} as unknown as EntityDefinition;

type ActionHandler = (doc: BaseDocument, ctx: unknown, services: HookServices) => Promise<unknown>;

function onConvert(handler: ActionHandler): void {
  (hookRunner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set("Booking", new Map([["action:convert", handler]]));
}

async function stored(doctype: string, name: string): Promise<Record<string, unknown> | null> {
  return (await db.findOne(doctype, name, "app")) as Record<string, unknown> | null;
}

async function insertAttachedBooking(fileId: string): Promise<string> {
  await db.insertOne(
    DIGITA.COLLECTIONS.FILE,
    { _id: fileId, doctype: "file", docstatus: 0, is_private: true, file_name: "a.pdf", storage_key: `bookings/${fileId}.pdf`, owner: admin.email },
    "core",
  );
  const doc = await docService.insert("Booking", { title: "B", attachment: `/api/v1/file/${fileId}/download` }, admin);
  return doc._id;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as any).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  for (const [collection, target] of [
    ["_sequences", "app"], ["_sequences", "core"], ["_doc_guards", "core"], ["_versions", "audits"],
    ["_view_logs", "logs"], ["Log", "logs"], ["WorkOrder", "app"], ["Booking", "app"], [DIGITA.COLLECTIONS.FILE, "core"],
  ] as const) {
    await db.ensureCollection(collection, target);
  }

  registry = new EntityRegistry();
  registry.register(workOrder);
  registry.register(booking);
  const permissionChecker = new PermissionChecker(registry);
  hookRunner = new HookRunner();
  hookRunner.setServices({ db, registry, decryptPassword });
  const storage = { backend: "local", delete: async (key: string) => { deletedBlobs.push(key); } } as unknown as StoragePort;

  docService = new DocumentService({
    tenantTimeZone: () => "UTC",
    registry,
    db,
    permissionChecker,
    hookRunner,
    linkValidator: new LinkValidator(registry, db, permissionChecker),
    linkTitleResolver: new LinkTitleResolver(registry, db, new TranslationService(db), permissionChecker),
    fetchFromResolver: new FetchFromResolver(registry, db),
    deleteProtection: new DeleteProtection(registry, db),
    cancelProtection: new CancelProtection(registry, db),
    versionService: new VersionService(db),
    viewLogService: new ViewLogService(db),
    activityLogService: new ActivityLogService(db),
    translationService: new TranslationService(db),
    workflowEngine: new WorkflowEngine(),
    storage,
  });
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

beforeEach(() => {
  deletedBlobs.length = 0;
});

afterEach(() => {
  (hookRunner as unknown as { hooks: Map<string, unknown> }).hooks.delete("Booking");
});

describe("A document service call with the caller's session joins its transaction", () => {
  it("rolls back an insert and a transition together when the action fails afterwards", async () => {
    const bookingId = (await docService.insert("Booking", { title: "B" }, admin))._id;
    const workOrdersBefore = await db.count("WorkOrder", [], "app");
    onConvert(async (doc, ctx, services) => {
      await docService.insert("WorkOrder", { title: "Repair" }, admin, undefined, services.session);
      await docService.transition("Booking", doc._id, "converted", admin, undefined, services.session);
      throw new Error("the action fails after the move");
    });

    await expect(docService.runAction("Booking", bookingId, "convert", admin)).rejects.toThrow("the action fails after the move");

    expect((await stored("Booking", bookingId))?.["status"]).toBe("open");
    expect(await db.count("WorkOrder", [], "app")).toBe(workOrdersBefore);
  });

  it("lets an update link and fetch from a document the action inserted", async () => {
    const bookingId = (await docService.insert("Booking", { title: "B" }, admin))._id;
    onConvert(async (doc, ctx, services) => {
      const wo = await docService.insert("WorkOrder", { title: "Repair" }, admin, undefined, services.session);
      await docService.update("Booking", doc._id, { work_order: wo._id, status: "converted" }, admin, undefined, { sessionOverride: services.session });
      return wo._id;
    });

    const workOrderId = await docService.runAction("Booking", bookingId, "convert", admin);

    const row = await stored("Booking", bookingId);
    expect(row?.["work_order"]).toBe(workOrderId);
    expect(row?.["work_order_title"]).toBe("Repair");
    expect(row?.["status"]).toBe("converted");
  });

  it("lets an insert fetch from a document the action inserted", async () => {
    const bookingId = (await docService.insert("Booking", { title: "B" }, admin))._id;
    onConvert(async (doc, ctx, services) => {
      const wo = await docService.insert("WorkOrder", { title: "Follow-up" }, admin, undefined, services.session);
      return (await docService.insert("Booking", { title: "B2", work_order: wo._id }, admin, undefined, services.session))._id;
    });

    const followUpId = (await docService.runAction("Booking", bookingId, "convert", admin)) as string;

    expect((await stored("Booking", followUpId))?.["work_order_title"]).toBe("Follow-up");
  });

  it("refuses to delete a document the action linked to before", async () => {
    const bookingId = (await docService.insert("Booking", { title: "B" }, admin))._id;
    const target = await docService.insert("WorkOrder", { title: "Target" }, admin);
    onConvert(async (doc, ctx, services) => {
      await docService.insert("Booking", { title: "Links the target", work_order: target._id }, admin, undefined, services.session);
      await docService.deleteDoc("WorkOrder", target._id, admin, undefined, services.session);
    });

    await expect(docService.runAction("Booking", bookingId, "convert", admin)).rejects.toBeInstanceOf(DeleteBlockedError);

    expect(await stored("WorkOrder", target._id)).not.toBeNull();
  });

  it("rolls back a delete, and keeps its attachment, when the action fails afterwards", async () => {
    const bookingId = await insertAttachedBooking("FILE-000701");
    const other = (await docService.insert("Booking", { title: "Runs the action" }, admin))._id;
    onConvert(async (doc, ctx, services) => {
      await docService.deleteDoc("Booking", bookingId, admin, undefined, services.session);
      throw new Error("the action fails after the delete");
    });

    await expect(docService.runAction("Booking", other, "convert", admin)).rejects.toThrow("the action fails after the delete");

    expect(await stored("Booking", bookingId)).not.toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-000701", "core")).not.toBeNull();
    expect(deletedBlobs).toEqual([]);
  });

  it("keeps an attachment an update cleared when the action fails afterwards", async () => {
    const bookingId = await insertAttachedBooking("FILE-000702");
    onConvert(async (doc, ctx, services) => {
      await docService.update("Booking", doc._id, { attachment: null }, admin, undefined, { sessionOverride: services.session });
      throw new Error("the action fails after the update");
    });

    await expect(docService.runAction("Booking", bookingId, "convert", admin)).rejects.toThrow("the action fails after the update");

    expect((await stored("Booking", bookingId))?.["attachment"]).toBe("/api/v1/file/FILE-000702/download");
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-000702", "core")).not.toBeNull();
    expect(deletedBlobs).toEqual([]);
  });

  it("removes the file an update cleared once the action commits", async () => {
    const bookingId = await insertAttachedBooking("FILE-000704");
    onConvert(async (doc, ctx, services) => {
      await docService.update("Booking", doc._id, { attachment: null }, admin, undefined, { sessionOverride: services.session });
    });

    await docService.runAction("Booking", bookingId, "convert", admin);

    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-000704", "core")).toBeNull();
    expect(deletedBlobs).toEqual(["bookings/FILE-000704.pdf"]);
  });

  it("removes the attachment of a delete once the action commits", async () => {
    const bookingId = await insertAttachedBooking("FILE-000703");
    const other = (await docService.insert("Booking", { title: "Runs the action" }, admin))._id;
    onConvert(async (doc, ctx, services) => {
      await docService.deleteDoc("Booking", bookingId, admin, undefined, services.session);
    });

    await docService.runAction("Booking", other, "convert", admin);

    expect(await stored("Booking", bookingId)).toBeNull();
    expect(await db.findOne(DIGITA.COLLECTIONS.FILE, "FILE-000703", "core")).toBeNull();
    expect(deletedBlobs).toEqual(["bookings/FILE-000703.pdf"]);
  });
});

describe("A read with the caller's session sees what its transaction wrote", () => {
  it("PLANTED DEFECT: reads, lists, finds and counts a document the action inserted, before the commit", async () => {
    const bookingId = (await docService.insert("Booking", { title: "B" }, admin))._id;
    onConvert(async (_doc, _ctx, services) => {
      const wo = await docService.insert("WorkOrder", { title: "Read back" }, admin, undefined, services.session);
      const filter = [{ title: "Read back" }];
      return {
        title: (await docService.getDoc("WorkOrder", wo._id, admin, undefined, undefined, services.session))._data["title"],
        listed: (await docService.getList("WorkOrder", { filters: [["title", "=", "Read back"]] }, admin, undefined, undefined, { session: services.session })).total,
        exists: await docService.exists("WorkOrder", wo._id, admin, services.session),
        counted: await docService.count("WorkOrder", filter, admin, { session: services.session }),
        outside: await docService.exists("WorkOrder", wo._id, admin),
      };
    });

    const seen = await docService.runAction("Booking", bookingId, "convert", admin);

    expect(seen).toEqual({ title: "Read back", listed: 1, exists: true, counted: 1, outside: false });
  });
});
