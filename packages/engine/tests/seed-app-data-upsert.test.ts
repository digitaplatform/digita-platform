import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// The seed loader's two modes: insert (skip what exists) and upsert-delete (replace
// what changed, then delete the site's rows the seed wrote and no longer carries). The
// website engine seeds its site in upsert-delete mode so a page changed in the catalog
// reaches the live site and a page dropped from the catalog leaves it.
const { logSpy } = vi.hoisted(() => ({
  logSpy: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => logSpy,
  getRootLogger: () => logSpy,
}));
vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l",
    MONGODB_AUDITS_DB: "a", MONGODB_CORE_DB: "c", MONGODB_APP_DB_PREFIX: "test",
    // An app engine of a demo tenant, the only engine the reseed route runs on.
    DEMO_TENANT: true, SITE_ID: "",
  },
}));

import type { FastifyInstance } from "fastify";
import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import type { TranslationService } from "../src/core/i18n/translation-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { DeleteBlockedError, NotFoundError } from "../src/core/document/document-service.js";
import { seedAppData, seedHash } from "../src/core/setup/seed-app-data.js";
import { readStoredRow } from "../src/core/entity/field-types.js";
import { registerAdminReseedRoutes } from "../src/core/api/admin-reseed-router.js";
import { configurePasswordFieldKeys, decryptPassword } from "../src/core/entity/password-cipher.js";

const page: EntityDefinition = {
  name: "WebPage",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "site", fieldtype: "Data", label: "Site" },
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "published"] },
    {
      fieldname: "blocks",
      fieldtype: "Table",
      label: "Blocks",
      child_fields: [
        { fieldname: "type", fieldtype: "Data", label: "Type" },
        { fieldname: "props", fieldtype: "JSON", label: "Props" },
      ],
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

/** A menu whose child rows link pages: `WebNavMenu.items.page -> WebPage`. */
const menu: EntityDefinition = {
  name: "WebNavMenu",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "site", fieldtype: "Data", label: "Site" },
    {
      fieldname: "items",
      fieldtype: "Table",
      label: "Items",
      child_fields: [{ fieldname: "page", fieldtype: "Link", label: "Page", options: "WebPage" }],
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

/** An app's single settings: a neutral row in `seeds/`, the demo company's values in `seeds-demo/`. */
const shopSetting: EntityDefinition = {
  name: "ShopSetting",
  module: "test",
  database: "app",
  is_single: true,
  fields: [
    { fieldname: "company_name", fieldtype: "Data", label: "Company name" },
    { fieldname: "hourly_rate", fieldtype: "Currency", label: "Hourly rate" },
    { fieldname: "quote_threshold", fieldtype: "Int", label: "Quote threshold" },
  ],
  permissions: [],
} as unknown as EntityDefinition;

const seedHome = { _id: "site::en::", site: "site", title: "New home", status: "published", blocks: [{ type: "hero", props: { heading: "Hi" } }] };
const seedConcept = { _id: "site::en::concept", site: "site", title: "The concept", status: "published", blocks: [] };

/** A stored home page as this loader wrote it on an earlier boot, with a child row id. */
const storedHome = {
  _id: "site::en::",
  doctype: "WebPage",
  docstatus: 0,
  site: "site",
  title: "Old home",
  status: "published",
  blocks: [{ type: "hero", props: { heading: "Hi" }, _row_id: "row0000000000001" }],
  owner: "admin@example.com",
  creation: new Date("2026-01-01T00:00:00Z"),
  modified_by: "admin@example.com",
  modified: new Date("2026-01-02T00:00:00Z"),
};

/** A database that holds the old home page and one page the seed does not carry. */
function mockDb(initial: Record<string, unknown>[]) {
  const stored = new Map<string, Record<string, unknown>>(initial.map((doc) => [String(doc._id), doc]));
  // WebPage's unique index on (site, locale, slug), as Mongo refuses it: E11000. Only rows
  // that carry a slug take part, so the other tests' rows without one never collide.
  const refuseDuplicateSlug = (id: string, doc: Record<string, unknown>) => {
    if (doc.slug == null) return;
    for (const other of stored.values()) {
      if (String(other._id) !== id && other.site === doc.site && other.slug === doc.slug) {
        throw Object.assign(new Error(`E11000 duplicate key: ${String(doc.slug)}`), { code: 11000 });
      }
    }
  };
  const db = {
    findOne: vi.fn(async (_coll: string, id: string, _target: string, _session?: unknown, options: { includeDeleted?: boolean } = {}) => {
      const doc = stored.get(id);
      return doc && (options.includeDeleted || doc.deleted == null) ? doc : null;
    }),
    // Reads one collection and honors `{ field: value }` filters and the projection, as the real find does.
    find: vi.fn(async (coll: string, options: { filters?: Record<string, unknown>[]; fields?: string[]; includeDeleted?: boolean }) =>
      [...stored.values()]
        .filter((doc) => doc.doctype === coll)
        .filter((doc) => options.includeDeleted || doc.deleted == null)
        .filter((doc) => (options.filters ?? []).every((f) => Object.entries(f).every(([k, v]) => doc[k] === v)))
        .map((doc) => Object.fromEntries((options.fields ?? Object.keys(doc)).map((f) => [f, doc[f]]))),
    ),
    deleteOne: vi.fn(async () => {}),
    insertMany: vi.fn(async (_coll: string, docs: Record<string, unknown>[]) => {
      for (const doc of docs) {
        refuseDuplicateSlug(String(doc._id), doc);
        stored.set(String(doc._id), doc);
      }
    }),
    // replaceOne keeps the stored _id; the written document carries none.
    upsertOne: vi.fn(async (_coll: string, id: string, data: Record<string, unknown>, _target: string, _session?: unknown, expected?: Record<string, unknown>) => {
      expect(data).not.toHaveProperty("_id");
      const old = stored.get(id);
      if (expected && (!old || !Object.entries(expected).every(([k, v]) => v === null ? old[k] == null : JSON.stringify(old[k]) === JSON.stringify(v)))) return false;
      refuseDuplicateSlug(id, data);
      stored.set(id, { ...data, _id: stored.get(id)?._id ?? id });
      return true;
    }),
    // $set, and only while the stored row still holds `expected`, as the real updateOne does.
    updateOne: vi.fn(
      async (_coll: string, id: string, changes: Record<string, unknown>, _target: string, _session: unknown, expected: Record<string, unknown> = {}) => {
        const doc = stored.get(id);
        // Compared by value, as Mongo compares a stored Date with the one the filter names.
        if (!doc || !Object.entries(expected).every(([k, v]) => v === null ? doc[k] == null : JSON.stringify(doc[k]) === JSON.stringify(v))) return false;
        stored.set(id, { ...doc, ...changes });
        return true;
      },
    ),
    deleteMany: vi.fn(async () => 0),
    listAppDatabases: vi.fn(() => [{ name: "app" }]),
    getNextSequence: vi.fn(async () => 1),
    setSequenceValue: vi.fn(async () => {}),
    setSequenceFloor: vi.fn(async () => {}),
  } as unknown as MongoDBService;
  return { db, stored };
}

function registry() {
  const reg = new EntityRegistry();
  reg.register(page);
  reg.register(menu);
  reg.register(shopSetting);
  return reg;
}

let dir: string;
async function seedFile(rows: unknown[], into: string = dir) {
  await writeFile(join(into, "WebPage.seed.json"), JSON.stringify(rows));
}

/** Deletes as the real service does: a row a stored menu item still links to is refused. */
function mockDocumentService(stored: Map<string, Record<string, unknown>>) {
  return {
    deleteDoc: vi.fn(async (doctype: string, id: string) => {
      const linking = [...stored.values()].filter((doc) =>
        doc.deleted == null && ((doc.items as Array<{ page?: string }> | undefined) ?? []).some((item) => item.page === id),
      );
      if (linking.length > 0) throw new DeleteBlockedError(doctype, id, [{ entity: "WebNavMenu", count: linking.length }]);
      stored.set(id, { ...stored.get(id)!, deleted: new Date(), deleted_by: "system", modified: new Date(), modified_by: "system" });
    }),
  } as unknown as DocumentService;
}

/** The website engine's call: upsert the seed, then sweep the site. */
function seedSite(db: MongoDBService, documentService: DocumentService, dirs: string[] = [dir]) {
  return seedAppData(db, registry(), {} as NamingService, dirs, { mode: "upsert-delete", site: "site", documentService });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seed-upsert-"));
  await seedFile([seedHome, seedConcept]);
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("seedAppData modes", () => {
  it("does not allocate or advertise a new identity for a deleted business key", async () => {
    const deleted = { ...storedHome, _id: "PAGE-00001", slug: "home", deleted: new Date(), deleted_by: "admin@example.com" };
    const { _id: _omit, ...seed } = seedHome;
    void _omit;
    await seedFile([{ ...seed, slug: "home" }, { ...seedConcept, slug: "concept" }]);
    const { db, stored } = mockDb([deleted]);
    const reg = registry();
    reg.register({ ...page, business_key: ["site", "slug"], naming: { strategy: "auto_increment", prefix: "PAGE-" } });
    await seedAppData(db, reg, {} as NamingService, [dir]);
    expect(stored.get("PAGE-00001")).toEqual(deleted);
    expect(db.getNextSequence).not.toHaveBeenCalled();
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("site::en::concept")?.slug).toBe("concept");
    expect([...stored.values()].filter((doc) => doc.slug === "home")).toHaveLength(1);
  });

  it.each(["insert", "upsert-delete"] as const)("%s never restores an already-deleted seed row", async (mode) => {
    const deleted = { ...storedHome, deleted: new Date("2026-02-01T00:00:00Z"), deleted_by: "admin@example.com" };
    const { db, stored } = mockDb([deleted]);
    await seedAppData(db, registry(), {} as NamingService, [dir], {
      mode, site: "site", documentService: mockDocumentService(stored),
    });
    expect(stored.get(String(deleted._id))).toEqual(deleted);
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
  });

  it("does not replace a row deleted after the seed read", async () => {
    const { db, stored } = mockDb([storedHome]);
    const replace = db.upsertOne.bind(db);
    vi.mocked(db.upsertOne).mockImplementationOnce(async (...args) => {
      stored.set(args[1], { ...stored.get(args[1])!, deleted: new Date(), deleted_by: "admin@example.com" });
      return replace(...args);
    });
    await seedSite(db, mockDocumentService(stored));
    expect(stored.get(String(storedHome._id))).toMatchObject({ title: "Old home", deleted: expect.any(Date), deleted_by: "admin@example.com" });
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
  });
  it("insert mode (the default) skips an existing row and inserts a new one", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedAppData(db, registry(), {} as NamingService, [dir]);
    // The planted defect this test guards: a default call that replaces existing rows.
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("site::en::")?.title).toBe("Old home");
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
    expect(db.deleteMany).not.toHaveBeenCalled();
  });

  it("upsert-delete mode replaces a changed row, keeps creation, owner and the child row ids", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedSite(db, mockDocumentService(stored));
    expect(db.upsertOne).toHaveBeenCalledTimes(1);
    const home = stored.get("site::en::")!;
    expect(home.title).toBe("New home");
    expect(home.owner).toBe("admin@example.com");
    expect(home.creation).toEqual(storedHome.creation);
    expect(home.modified_by).toBe("system");
    expect(home.modified).not.toEqual(storedHome.modified);
    expect((home.blocks as Array<Record<string, unknown>>)[0]?._row_id).toBe("row0000000000001");
    expect(stored.get("site::en::concept")?.title).toBe("The concept");
  });

  it("upsert-delete mode writes nothing for an unchanged seed, so modified stays as it was", async () => {
    const { db, stored } = mockDb([storedHome]);
    await seedSite(db, mockDocumentService(stored));
    const afterFirst = { ...stored.get("site::en::")! };
    vi.clearAllMocks();
    await seedSite(db, mockDocumentService(stored));
    // The planted defect: a loader that rewrites every row on every boot.
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(db.insertMany).not.toHaveBeenCalled();
    expect(stored.get("site::en::")?.modified).toEqual(afterFirst.modified);
    expect((stored.get("site::en::")!.blocks as Array<Record<string, unknown>>)[0]?._row_id).toBe("row0000000000001");
  });

  it("upsert-delete mode refuses an invalid docstatus exactly as insert mode does", async () => {
    await seedFile([{ ...seedHome, docstatus: 5 }]);
    const { db, stored } = mockDb([storedHome]);
    await expect(seedSite(db, mockDocumentService(stored))).rejects.toMatchObject({ code: "seed_row_docstatus_invalid", params: { value: "5" } });
    expect(db.upsertOne).not.toHaveBeenCalled();
    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).rejects.toMatchObject({ code: "seed_row_docstatus_invalid", params: { value: "5" } });
  });
});

describe("seedAppData upsert-delete mode", () => {
  /** Rows of the site the seed no longer carries: one the seed wrote, one a person last changed. */
  // The seed stamps the hash of the values it wrote; a person's change breaks it.
  const seedWroteValues = { ...storedHome, _id: "site::en::dropped", title: "Dropped", owner: "system", modified_by: "system" };
  const seedWrote = { ...seedWroteValues, _seed_hash: seedHash(seedWroteValues) };
  const personChangedValues = { ...storedHome, _id: "site::en::mine", title: "Mine", owner: "system", modified_by: "admin@example.com" };
  const personChanged = { ...personChangedValues, _seed_hash: seedHash({ ...personChangedValues, title: "Seeded" }) };
  const otherSite = { ...seedWrote, _id: "other::en::dropped", site: "other" };

  it("deletes a row the seed wrote and no longer carries, through the document service, and logs it", async () => {
    const { db, stored } = mockDb([storedHome, seedWrote]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    expect(documentService.deleteDoc).toHaveBeenCalledTimes(1);
    expect(documentService.deleteDoc).toHaveBeenCalledWith(
      "WebPage",
      "site::en::dropped",
      expect.objectContaining({ email: "system", roles: ["Administrator"] }),
    );
    expect(stored.get("site::en::dropped")?.deleted).toBeInstanceOf(Date);
    expect(stored.get("site::en::")?.title).toBe("New home");
    const logged = logSpy.info.mock.calls.find(([, msg]) => String(msg).includes("deleted rows"));
    expect(logged?.[0]).toMatchObject({ entity: "WebPage", site: "site", deleted: 1, ids: ["site::en::dropped"] });
  });

  it("never reads or deletes a row of another site", async () => {
    const { db, stored } = mockDb([storedHome, otherSite]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    // The planted defect this test guards: a sweep over the whole collection.
    expect(documentService.deleteDoc).not.toHaveBeenCalled();
    expect(stored.get("other::en::dropped")?.title).toBe("Dropped");
    for (const [, options] of (db.find as ReturnType<typeof vi.fn>).mock.calls) {
      expect(options.filters).toEqual([{ site: "site" }]);
    }
  });

  it("keeps a row the seed does not carry that a person last changed, and logs it", async () => {
    const { db, stored } = mockDb([storedHome, personChanged, seedWrote]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    // The planted defect this test guards: a sweep that reads `owner` alone.
    expect(documentService.deleteDoc).not.toHaveBeenCalledWith("WebPage", "site::en::mine", expect.anything());
    expect(stored.get("site::en::mine")?.title).toBe("Mine");
    expect(stored.get("site::en::dropped")?.deleted).toBeInstanceOf(Date);
    const kept = logSpy.warn.mock.calls.find(([, msg]) => String(msg).includes("a person created or changed"));
    expect(kept?.[0]).toMatchObject({ entity: "WebPage", site: "site", kept: 1, ids: ["site::en::mine"] });
  });

  it("sweeps the site once over the rows of every seed dir, so one dir never deletes another dir's rows", async () => {
    // Two app dirs each carry a `sites/<SITE_ID>/WebPage.seed.json`: the catalog and an overlay.
    const overlay = await mkdtemp(join(tmpdir(), "seed-upsert-overlay-"));
    try {
      await seedFile([seedHome]);
      await seedFile([seedConcept], overlay);
      const { db, stored } = mockDb([storedHome, seedWrote]);
      const documentService = mockDocumentService(stored);
      await seedSite(db, documentService, [dir, overlay]);
      // The planted defect this test guards: a sweep per seed file, each deleting what the other seeded.
      expect(documentService.deleteDoc).toHaveBeenCalledTimes(1);
      expect(documentService.deleteDoc).toHaveBeenCalledWith("WebPage", "site::en::dropped", expect.anything());
      expect(stored.get("site::en::")?.title).toBe("New home");
      expect(stored.get("site::en::concept")?.title).toBe("The concept");
    } finally {
      await rm(overlay, { recursive: true, force: true });
    }
  });

  it("keeps a deleted stale row's unique key reserved against another seed row", async () => {
    // The catalog renamed the slug of `plans` to `pricing` and dropped the page that held it.
    // Each as the seed wrote it, its slug among the values it stamped.
    const stamped = (values: Record<string, unknown>) => ({ ...values, _seed_hash: seedHash(values) });
    const stalePricing = stamped({ ...seedWroteValues, _id: "site::en::pricing", slug: "pricing" });
    const storedPlans = stamped({ ...seedWroteValues, _id: "site::en::plans", title: "Plans", slug: "plans" });
    await seedFile([seedHome, { ...seedConcept, _id: "site::en::plans", title: "Plans", slug: "pricing" }]);
    const { db, stored } = mockDb([storedHome, stalePricing, storedPlans]);
    const documentService = mockDocumentService(stored);
    // The planted defect this test guards: a sweep that runs after the write, which then
    // used to release the stale row's unique key by physically deleting it.
    await expect(seedSite(db, documentService)).rejects.toMatchObject({ code: 11000 });
    expect(documentService.deleteDoc).toHaveBeenCalledWith("WebPage", "site::en::pricing", expect.anything());
    expect(stored.get("site::en::pricing")?.deleted).toBeInstanceOf(Date);
    expect(stored.get("site::en::plans")?.slug).toBe("plans");
  });

  it("deletes a dropped page a carried menu linked once the seed has rewritten the menu", async () => {
    // The catalog dropped `dropped` and pointed the menu at the home page instead. The stored
    // menu still links `dropped` when the sweep runs, so its delete is refused until Pass 4
    // has rewritten the menu.
    const menuValues = { ...seedWroteValues, _id: "site::main", doctype: "WebNavMenu", items: [{ page: "site::en::dropped", _row_id: "row0000000000002" }] };
    const storedMenu = { ...menuValues, _seed_hash: seedHash(menuValues) };
    await writeFile(join(dir, "WebNavMenu.seed.json"), JSON.stringify([{ _id: "site::main", site: "site", items: [{ page: "site::en::" }] }]));
    const { db, stored } = mockDb([storedHome, seedWrote, storedMenu]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    // The planted defect this test guards: one sweep before the write, which leaves the page
    // published until the next boot.
    expect(stored.get("site::en::dropped")?.deleted).toBeInstanceOf(Date);
    expect((stored.get("site::main")!.items as Array<Record<string, unknown>>)[0]?.page).toBe("site::en::");
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("keeps a dropped page a row the seed does not rewrite still links to, and logs the link", async () => {
    // The seed carries another menu, so the sweep reads the site's menus; a person last changed
    // `site::main` and the seed does not carry it, so the sweep keeps it and it keeps linking the page.
    const personsMenu = { ...personChanged, _id: "site::main", doctype: "WebNavMenu", items: [{ page: "site::en::dropped", _row_id: "row0000000000002" }] };
    await writeFile(join(dir, "WebNavMenu.seed.json"), JSON.stringify([{ _id: "site::footer", site: "site", items: [] }]));
    const { db, stored } = mockDb([storedHome, seedWrote, personsMenu]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    expect(documentService.deleteDoc).toHaveBeenCalledTimes(2);
    expect(documentService.deleteDoc).not.toHaveBeenCalledWith("WebNavMenu", "site::main", expect.anything());
    expect(stored.get("site::main")?.title).toBe("Mine");
    expect(stored.get("site::footer")?.doctype).toBe("WebNavMenu");
    expect(stored.has("site::en::dropped")).toBe(true);
    const blocked = logSpy.error.mock.calls.find(([, msg]) => String(msg).includes("still links"));
    expect(blocked?.[0]).toMatchObject({ entity: "WebPage", id: "site::en::dropped", blockers: [{ entity: "WebNavMenu", count: 1 }] });
  });

  it("keeps a dropped page a person changed between the sweep and the retry, and logs it", async () => {
    // The stored menu links `dropped` when the sweep runs and the seed rewrites the menu, so
    // the retry after the write would delete the page; a person changed the page through
    // another engine meanwhile, so the retry reads it again and keeps it.
    const menuValues = { ...seedWroteValues, _id: "site::main", doctype: "WebNavMenu", items: [{ page: "site::en::dropped", _row_id: "row0000000000002" }] };
    const storedMenu = { ...menuValues, _seed_hash: seedHash(menuValues) };
    await writeFile(join(dir, "WebNavMenu.seed.json"), JSON.stringify([{ _id: "site::main", site: "site", items: [{ page: "site::en::" }] }]));
    const { db, stored } = mockDb([storedHome, seedWrote, storedMenu]);
    const refusing = mockDocumentService(stored);
    const documentService = {
      deleteDoc: vi.fn(async (...args: Parameters<DocumentService["deleteDoc"]>) => {
        try {
          await refusing.deleteDoc(...args);
        } catch (err) {
          stored.set(args[1], { ...stored.get(args[1])!, title: "Edited", modified_by: "editor@example.com" });
          throw err;
        }
      }),
    } as unknown as DocumentService;
    await seedSite(db, documentService);
    // The planted defect this test guards: a retry that trusts the check the sweep made before the write.
    expect(documentService.deleteDoc).toHaveBeenCalledTimes(1);
    expect(stored.has("site::en::dropped")).toBe(true);
    const kept = logSpy.warn.mock.calls.find(([, msg]) => String(msg).includes("since the sweep"));
    expect(kept?.[0]).toMatchObject({ entity: "WebPage", site: "site", id: "site::en::dropped" });
    expect(logSpy.error).not.toHaveBeenCalled();
  });

  it("takes a row another pod deleted first as gone, not as a failed delete", async () => {
    const { db } = mockDb([storedHome, seedWrote]);
    const documentService = {
      deleteDoc: vi.fn(async () => {
        throw new NotFoundError("WebPage", "site::en::dropped");
      }),
    } as unknown as DocumentService;
    await seedSite(db, documentService);
    expect(documentService.deleteDoc).toHaveBeenCalledTimes(1);
    expect(logSpy.error).not.toHaveBeenCalled();
    expect(logSpy.info.mock.calls.find(([, msg]) => String(msg).includes("deleted rows"))).toBeUndefined();
  });

  it("insert mode deletes nothing, whatever the seed does not carry", async () => {
    const { db, stored } = mockDb([storedHome, seedWrote, personChanged, otherSite]);
    await seedAppData(db, registry(), {} as NamingService, [dir]);
    expect(db.deleteOne).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
    expect(stored.size).toBe(5);
  });
});


describe("seedAppData tiers in insert mode", () => {
  // An app dir with both tiers, loaded as the boot loads them: `seeds/` before `seeds-demo/`.
  let app: string;
  const neutral = { _id: "shop", company_name: "Workshop", quote_threshold: 150 };
  const demoCompany = { _id: "shop", company_name: "Veloluck Velo AG", hourly_rate: 120 };
  /** The reference tier's row as this loader stored it on an earlier boot. */
  const neutralValues = {
    ...neutral,
    doctype: "ShopSetting",
    docstatus: 0,
    owner: "system",
    creation: new Date("2026-01-01T00:00:00Z"),
    modified_by: "system",
    modified: new Date("2026-01-01T00:00:00Z"),
  };
  const storedNeutral = { ...neutralValues, _seed_hash: seedHash(neutralValues) };
  const bothTiers = () => [join(app, "seeds"), join(app, "seeds-demo")];
  const seedTiers = (db: MongoDBService, dirs: string[] = bothTiers()) =>
    seedAppData(db, registry(), {} as NamingService, dirs);

  beforeEach(async () => {
    app = await mkdtemp(join(tmpdir(), "seed-tiers-"));
    await mkdir(join(app, "seeds"));
    await mkdir(join(app, "seeds-demo"));
    await writeFile(join(app, "seeds", "ShopSetting.seed.json"), JSON.stringify([neutral]));
    await writeFile(join(app, "seeds-demo", "ShopSetting.seed.json"), JSON.stringify([demoCompany]));
  });
  afterEach(async () => {
    await rm(app, { recursive: true, force: true });
  });

  it("keeps the first of two demo directories that carry the reference tier's _id, and writes once", async () => {
    const second = await mkdtemp(join(tmpdir(), "seed-tiers-second-demo-"));
    await mkdir(join(second, "seeds-demo"));
    await writeFile(join(second, "seeds-demo", "ShopSetting.seed.json"), JSON.stringify([{ _id: "shop", company_name: "Second demo" }]));
    const { db, stored } = mockDb([]);
    const dirs = [join(app, "seeds"), join(app, "seeds-demo"), join(second, "seeds-demo")];

    await seedTiers(db, dirs);
    expect(stored.get("shop")?.company_name).toBe("Veloluck Velo AG");
    expect(db.updateOne).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    await seedTiers(db, dirs);
    expect(db.updateOne).not.toHaveBeenCalled();
    await rm(second, { recursive: true, force: true });
  });

  it("keeps the first of two reference directories that carry the same _id", async () => {
    const second = await mkdtemp(join(tmpdir(), "seed-tiers-second-"));
    await mkdir(join(second, "seeds"));
    await writeFile(join(second, "seeds", "ShopSetting.seed.json"), JSON.stringify([{ _id: "shop", company_name: "Second app" }]));
    const { db, stored } = mockDb([]);

    await seedTiers(db, [join(app, "seeds"), join(second, "seeds")]);

    expect(stored.get("shop")?.company_name).toBe("Workshop");
    await rm(second, { recursive: true, force: true });
  });

  it("lands the demo tier's values on the row the reference tier writes in the same load", async () => {
    const { db, stored } = mockDb([]);
    await seedTiers(db);
    // The planted defect this test guards: the demo row skipped because the reference row exists.
    expect(stored.get("shop")).toMatchObject({
      company_name: "Veloluck Velo AG",
      hourly_rate: 120,
      quote_threshold: 150,
      owner: "system",
      modified_by: "system",
    });
  });

  it("updates a standing tenant's row the reference tier wrote on an earlier boot, keeping creation", async () => {
    const { db, stored } = mockDb([storedNeutral]);
    await seedTiers(db);
    const shop = stored.get("shop")!;
    expect(shop).toMatchObject({ company_name: "Veloluck Velo AG", hourly_rate: 120, quote_threshold: 150 });
    expect(shop.owner).toBe("system");
    expect(shop.modified_by).toBe("system");
    expect(shop.creation).toEqual(storedNeutral.creation);
    expect(shop.modified).not.toEqual(storedNeutral.modified);
  });

  it("keeps the values of a row a person saved after the seed wrote it", async () => {
    const saved = { ...storedNeutral, company_name: "Meier Velos", modified_by: "admin@example.com" };
    const { db, stored } = mockDb([saved]);
    await seedTiers(db);
    // The planted defect this test guards: a later tier that overwrites a person's save.
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("shop")).toEqual(saved);
  });

  it("keeps a person's values that a rule without a user saved again afterwards", async () => {
    // The person changes the company; a rule without a user then saves the row as "system",
    // which makes it look written by the seed to a check of the last writer.
    const ruleSaved = { ...storedNeutral, company_name: "Meier Velos", modified_by: "system", modified: new Date("2026-01-04T00:00:00Z") };
    const { db, stored } = mockDb([ruleSaved]);
    await seedTiers(db);
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("shop")).toEqual(ruleSaved);
  });

  it("treats a row stored before the seed stamped its rows as not the seed's", async () => {
    const { _seed_hash: _dropped, ...legacy } = storedNeutral;
    void _dropped;
    const { db, stored } = mockDb([legacy]);
    await seedTiers(db);
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(stored.get("shop")).toEqual(legacy);
  });

  it("keeps the values of a person who saves the row while the seed runs", async () => {
    const { db, stored } = mockDb([storedNeutral]);
    // The person's save lands right after the demo tier, the second tier to read the row, read it
    // as seed-owned.
    let reads = 0;
    (db.findOne as ReturnType<typeof vi.fn>).mockImplementation(async (_coll: string, id: string) => {
      const doc = stored.get(id) ?? null;
      if (doc && ++reads === 2) {
        stored.set("shop", { ...storedNeutral, company_name: "Meier Velos", modified_by: "admin@example.com", modified: new Date("2026-01-03T00:00:00Z") });
      }
      return doc;
    });
    await seedTiers(db);
    // The planted defect this test guards: a write that trusts the read made before it.
    expect(stored.get("shop")).toMatchObject({ company_name: "Meier Velos", modified_by: "admin@example.com" });
    expect(stored.get("shop")).not.toHaveProperty("hourly_rate");
    // The demo tier's count says it wrote nothing.
    const counts = logSpy.info.mock.calls.filter(([fields]) => fields?.entity === "ShopSetting").map(([fields]) => fields);
    expect(counts.at(-1)).toMatchObject({ updated: 0, skipped: 1 });
  });

  it("writes nothing once the stored row carries the demo tier's values", async () => {
    const { db, stored } = mockDb([storedNeutral]);
    await seedTiers(db);
    const landed = { ...stored.get("shop")! };
    vi.clearAllMocks();
    await seedTiers(db);
    // The planted defect this test guards: a loader that rewrites the row on every boot.
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(db.insertMany).not.toHaveBeenCalled();
    expect(stored.get("shop")).toEqual(landed);
  });

  it("never lets a tier that loads alone change a row it carries", async () => {
    const landed = { ...storedNeutral, ...demoCompany };
    const { db, stored } = mockDb([landed]);
    // The reference tier alone, as a boot with the demo tier switched off loads it.
    await seedTiers(db, [join(app, "seeds")]);
    // The planted defect this test guards: every seed-owned row following its seed, which puts
    // the neutral company back over the demo company.
    expect(db.updateOne).not.toHaveBeenCalled();
    expect(stored.get("shop")).toEqual(landed);
  });

  it("lands the demo tier's values through the demo reseed", async () => {
    const { db, stored } = mockDb([]);
    let reseed: ((request: unknown, reply: unknown) => Promise<unknown>) | undefined;
    const fastify = { post: (_path: string, handler: typeof reseed) => (reseed = handler) } as unknown as FastifyInstance;
    registerAdminReseedRoutes(fastify, "/api/v1", {
      db,
      registry: registry(),
      translationService: {} as TranslationService,
      appDirs: [app],
      getDomainDirs: () => [],
    });
    const reply = { code: vi.fn(() => reply), send: vi.fn() };
    await reseed!({ user: { email: "admin@example.com", roles: ["Administrator"] }, body: { mode: "demo" } }, reply);
    expect(reply.code).not.toHaveBeenCalled();
    // The planted defect this test guards: a reseed that loads each tier on its own.
    expect(stored.get("shop")).toMatchObject({ company_name: "Veloluck Velo AG", hourly_rate: 120, quote_threshold: 150 });
  });
});

describe("the seed's stamp", () => {
  /** An entity as a later release ships it, with one more field than the stamp knew. */
  const grown = (entity: EntityDefinition): EntityDefinition => ({
    ...entity,
    fields: [...entity.fields, { fieldname: "added_later", fieldtype: "Data", label: "Added later" }],
  } as EntityDefinition);
  const registryOf = (...entities: EntityDefinition[]) => {
    const reg = new EntityRegistry();
    for (const entity of entities) reg.register(entity);
    return reg;
  };
  let app: string;
  const neutralValues = {
    _id: "shop", company_name: "Workshop", quote_threshold: 150,
    doctype: "ShopSetting", docstatus: 0, owner: "system", modified_by: "system",
    creation: new Date("2026-01-01T00:00:00Z"), modified: new Date("2026-01-01T00:00:00Z"),
  };
  const tiers = () => [join(app, "seeds"), join(app, "seeds-demo")];

  beforeEach(async () => {
    app = await mkdtemp(join(tmpdir(), "seed-stamp-"));
    await mkdir(join(app, "seeds"));
    await mkdir(join(app, "seeds-demo"));
    await writeFile(join(app, "seeds", "ShopSetting.seed.json"), JSON.stringify([{ _id: "shop", company_name: "Workshop", quote_threshold: 150 }]));
    await writeFile(join(app, "seeds-demo", "ShopSetting.seed.json"), JSON.stringify([{ _id: "shop", hourly_rate: 130 }]));
  });
  afterEach(async () => {
    await rm(app, { recursive: true, force: true });
  });

  it("still sweeps a page the seed dropped after a release adds a field", async () => {
    const values = { ...storedHome, _id: "site::en::dropped", title: "Dropped", owner: "system", modified_by: "system" };
    const { db, stored } = mockDb([{ ...values, _seed_hash: seedHash(values) }]);
    await seedAppData(db, registryOf(grown(page), menu, shopSetting), {} as NamingService, [dir], {
      mode: "upsert-delete", site: "site", documentService: mockDocumentService(stored),
    });
    expect(stored.get("site::en::dropped")?.deleted).toBeInstanceOf(Date);
  });

  it("still lands a later tier after a release adds a field", async () => {
    const { db, stored } = mockDb([{ ...neutralValues, _seed_hash: seedHash(neutralValues) }]);
    await seedAppData(db, registryOf(page, menu, grown(shopSetting)), {} as NamingService, tiers());
    expect(stored.get("shop")?.hourly_rate).toBe(130);
  });

  it("still lands a later tier after a release removes a field", async () => {
    const shrunk = { ...shopSetting, fields: shopSetting.fields.filter((f) => f.fieldname !== "quote_threshold") } as EntityDefinition;
    const { db, stored } = mockDb([{ ...neutralValues, _seed_hash: seedHash(neutralValues) }]);
    await seedAppData(db, registryOf(page, menu, shrunk), {} as NamingService, tiers());
    expect(stored.get("shop")?.hourly_rate).toBe(130);
  });

  it("still lands a later tier after a release renames a field", async () => {
    const renamed = {
      ...shopSetting,
      fields: shopSetting.fields.map((f) => (f.fieldname === "company_name" ? { ...f, fieldname: "company" } : f)),
    } as EntityDefinition;
    const { db, stored } = mockDb([{ ...neutralValues, _seed_hash: seedHash(neutralValues) }]);
    await seedAppData(db, registryOf(page, menu, renamed), {} as NamingService, tiers());
    expect(stored.get("shop")?.hourly_rate).toBe(130);
  });

  it("stamps the row a later tier layered, over all it holds", async () => {
    const { db, stored } = mockDb([]);
    await seedAppData(db, registry(), {} as NamingService, tiers());
    const shop = stored.get("shop")!;
    expect(shop.hourly_rate).toBe(130);
    expect(shop._seed_hash).toBe(seedHash(shop));
  });

  it("leaves a row whose docstatus a person changed, though its values are the seed's", async () => {
    const { db, stored } = mockDb([{ ...neutralValues, docstatus: 1, _seed_hash: seedHash(neutralValues) }]);
    await seedAppData(db, registry(), {} as NamingService, tiers());
    expect(stored.get("shop")?.hourly_rate).toBeUndefined();
  });

  it("tells two dates apart, so a person's change of a Date or Datetime breaks the stamp", () => {
    expect(seedHash({ due: new Date("2026-01-01T00:00:00Z") })).not.toBe(seedHash({ due: new Date("2026-01-02T00:00:00Z") }));
  });

  it("leaves every _ key out, so the engine's own keys on a row keep the stamp", () => {
    expect(seedHash({ title: "t", _assign: ["clerk@test"], _liked_by: [] })).toBe(seedHash({ title: "t" }));
  });

  it("hashes an object value whatever the order of its keys", () => {
    const json = { ...page, fields: [{ fieldname: "props", fieldtype: "JSON", label: "Props" }] } as EntityDefinition;
    expect(seedHash({ props: { a: 1, b: 2 } })).toBe(seedHash({ props: { b: 2, a: 1 } }));
  });

  it("never shows the stamp to a read", () => {
    expect(readStoredRow(page, { _id: "p", title: "t", _seed_hash: "abc" })).not.toHaveProperty("_seed_hash");
  });
});

describe("a seeded Password value that decrypts to the same text is left alone", () => {
  // Encrypting draws a new IV each time, so the stored text never equals a fresh encryption.
  const gateway = {
    name: "PayGateway", module: "test", database: "app", naming: { strategy: "user_set" },
    fields: [
      { fieldname: "site", fieldtype: "Data", label: "Site" },
      { fieldname: "label", fieldtype: "Data", label: "Label" },
      { fieldname: "secret", fieldtype: "Password", label: "Secret" },
      {
        fieldname: "slots",
        fieldtype: "Table",
        label: "Slots",
        child_fields: [
          { fieldname: "label", fieldtype: "Data", label: "Label" },
          { fieldname: "pin", fieldtype: "Password", label: "PIN" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
  let app: string;
  const withGateway = () => {
    const reg = registry();
    reg.register(gateway);
    return reg;
  };

  beforeEach(async () => {
    configurePasswordFieldKeys({ PASSWORD_FIELD_KEYS: "k1=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", PASSWORD_FIELD_ACTIVE_KEY_ID: "k1" });
    app = await mkdtemp(join(tmpdir(), "seed-password-"));
    await mkdir(join(app, "seeds"));
    await mkdir(join(app, "seeds-demo"));
    await writeFile(join(app, "seeds", "PayGateway.seed.json"), JSON.stringify([{ _id: "gw", site: "site", label: "Gateway" }]));
    await writeFile(join(app, "seeds-demo", "PayGateway.seed.json"), JSON.stringify([{ _id: "gw", secret: "demo-pass" }]));
  });
  afterEach(async () => {
    await rm(app, { recursive: true, force: true });
  });

  it("writes nothing on the second load of both tiers", async () => {
    const { db, stored } = mockDb([]);
    const tiers = [join(app, "seeds"), join(app, "seeds-demo")];
    await seedAppData(db, withGateway(), {} as NamingService, tiers);
    const first = { ...stored.get("gw")! };
    vi.clearAllMocks();

    await seedAppData(db, withGateway(), {} as NamingService, tiers);

    expect(db.updateOne).not.toHaveBeenCalled();
    expect(stored.get("gw")).toEqual(first);
  });

  it("stores a seed text that changed since the last load", async () => {
    const { db, stored } = mockDb([]);
    const tiers = [join(app, "seeds"), join(app, "seeds-demo")];
    await seedAppData(db, withGateway(), {} as NamingService, tiers);
    await writeFile(join(app, "seeds-demo", "PayGateway.seed.json"), JSON.stringify([{ _id: "gw", secret: "new-pass" }]));

    await seedAppData(db, withGateway(), {} as NamingService, tiers);

    expect(decryptPassword(stored.get("gw")!.secret)).toBe("new-pass");
  });

  it("writes a value anew that a key no longer listed encrypted", async () => {
    const { db, stored } = mockDb([]);
    const tiers = [join(app, "seeds"), join(app, "seeds-demo")];
    await seedAppData(db, withGateway(), {} as NamingService, tiers);
    // As a stamped row whose secret a retired key encrypted.
    const retired = { ...stored.get("gw")!, secret: { ...(stored.get("gw")!.secret as object), key_id: "retired" } };
    stored.set("gw", { ...retired, _seed_hash: seedHash(retired) });

    await seedAppData(db, withGateway(), {} as NamingService, tiers);

    expect(stored.get("gw")!.secret).toMatchObject({ key_id: "k1" });
    expect(decryptPassword(stored.get("gw")!.secret)).toBe("demo-pass");
  });

  it("writes nothing on the second upsert of a row whose Table row holds a Password", async () => {
    await writeFile(join(app, "seeds", "PayGateway.seed.json"), JSON.stringify([{ _id: "gw", site: "site", label: "Gateway", slots: [{ label: "front", pin: "1234" }, { label: "back", pin: "5678" }] }]));
    const { db, stored } = mockDb([]);
    const upsert = () =>
      seedAppData(db, withGateway(), {} as NamingService, [join(app, "seeds")], {
        mode: "upsert-delete", site: "site", documentService: mockDocumentService(stored),
      });
    await upsert();
    vi.clearAllMocks();

    await upsert();

    expect(db.upsertOne).not.toHaveBeenCalled();
    const pins = (stored.get("gw")!.slots as Array<{ pin: unknown }>).map((slot) => decryptPassword(slot.pin));
    expect(pins).toEqual(["1234", "5678"]);
  });

  it("writes nothing on the second upsert of a site", async () => {
    await writeFile(join(app, "seeds", "PayGateway.seed.json"), JSON.stringify([{ _id: "gw", site: "site", label: "Gateway", secret: "site-pass" }]));
    const { db, stored } = mockDb([]);
    const upsert = () =>
      seedAppData(db, withGateway(), {} as NamingService, [join(app, "seeds")], {
        mode: "upsert-delete", site: "site", documentService: mockDocumentService(stored),
      });
    await upsert();
    const first = { ...stored.get("gw")! };
    vi.clearAllMocks();

    await upsert();

    expect(db.upsertOne).not.toHaveBeenCalled();
    expect(stored.get("gw")).toEqual(first);
  });
});
