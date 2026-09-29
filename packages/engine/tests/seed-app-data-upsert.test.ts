import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
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
  },
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";
import type { DocumentService } from "../src/core/document/document-service.js";
import type { NamingService } from "../src/core/document/naming-service.js";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { DeleteBlockedError, NotFoundError } from "../src/core/document/document-service.js";
import { seedAppData } from "../src/core/setup/seed-app-data.js";

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
    findOne: vi.fn(async (_coll: string, id: string) => stored.get(id) ?? null),
    // Reads one collection and honors `{ field: value }` filters and the projection, as the real find does.
    find: vi.fn(async (coll: string, options: { filters?: Record<string, unknown>[]; fields?: string[] }) =>
      [...stored.values()]
        .filter((doc) => doc.doctype === coll)
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
    upsertOne: vi.fn(async (_coll: string, id: string, data: Record<string, unknown>) => {
      expect(data).not.toHaveProperty("_id");
      refuseDuplicateSlug(id, data);
      stored.set(id, { ...data, _id: stored.get(id)?._id ?? id });
    }),
    updateOne: vi.fn(async () => {}),
    deleteMany: vi.fn(async () => 0),
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
        ((doc.items as Array<{ page?: string }> | undefined) ?? []).some((item) => item.page === id),
      );
      if (linking.length > 0) throw new DeleteBlockedError(doctype, id, [{ entity: "WebNavMenu", count: linking.length }]);
      stored.delete(id);
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
    await expect(seedSite(db, mockDocumentService(stored))).rejects.toThrow("invalid docstatus");
    expect(db.upsertOne).not.toHaveBeenCalled();
    await expect(seedAppData(db, registry(), {} as NamingService, [dir])).rejects.toThrow("invalid docstatus");
  });
});

describe("seedAppData upsert-delete mode", () => {
  /** Rows of the site the seed no longer carries: one the seed wrote, one a person last changed. */
  const seedWrote = { ...storedHome, _id: "site::en::dropped", title: "Dropped", owner: "system", modified_by: "system" };
  const personChanged = { ...storedHome, _id: "site::en::mine", title: "Mine", owner: "system", modified_by: "admin@example.com" };
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
    expect(stored.has("site::en::dropped")).toBe(false);
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
    expect(stored.has("site::en::dropped")).toBe(false);
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

  it("deletes a stale row before the seed writes, so a carried row can take its unique key", async () => {
    // The catalog renamed the slug of `plans` to `pricing` and dropped the page that held it.
    const stalePricing = { ...seedWrote, _id: "site::en::pricing", slug: "pricing" };
    const storedPlans = { ...seedWrote, _id: "site::en::plans", title: "Plans", slug: "plans" };
    await seedFile([seedHome, { ...seedConcept, _id: "site::en::plans", title: "Plans", slug: "pricing" }]);
    const { db, stored } = mockDb([storedHome, stalePricing, storedPlans]);
    const documentService = mockDocumentService(stored);
    // The planted defect this test guards: a sweep that runs after the write, which then
    // fails on the stale row's key at every boot, so the stale row is never deleted.
    await seedSite(db, documentService);
    expect(documentService.deleteDoc).toHaveBeenCalledWith("WebPage", "site::en::pricing", expect.anything());
    expect(stored.has("site::en::pricing")).toBe(false);
    expect(stored.get("site::en::plans")?.slug).toBe("pricing");
  });

  it("deletes a dropped page a carried menu linked once the seed has rewritten the menu", async () => {
    // The catalog dropped `dropped` and pointed the menu at the home page instead. The stored
    // menu still links `dropped` when the sweep runs, so its delete is refused until Pass 4
    // has rewritten the menu.
    const storedMenu = { ...seedWrote, _id: "site::main", doctype: "WebNavMenu", items: [{ page: "site::en::dropped", _row_id: "row0000000000002" }] };
    await writeFile(join(dir, "WebNavMenu.seed.json"), JSON.stringify([{ _id: "site::main", site: "site", items: [{ page: "site::en::" }] }]));
    const { db, stored } = mockDb([storedHome, seedWrote, storedMenu]);
    const documentService = mockDocumentService(stored);
    await seedSite(db, documentService);
    // The planted defect this test guards: one sweep before the write, which leaves the page
    // published until the next boot.
    expect(stored.has("site::en::dropped")).toBe(false);
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
    const storedMenu = { ...seedWrote, _id: "site::main", doctype: "WebNavMenu", items: [{ page: "site::en::dropped", _row_id: "row0000000000002" }] };
    await writeFile(join(dir, "WebNavMenu.seed.json"), JSON.stringify([{ _id: "site::main", site: "site", items: [{ page: "site::en::" }] }]));
    const { db, stored } = mockDb([storedHome, seedWrote, storedMenu]);
    const refusing = mockDocumentService(stored);
    const documentService = {
      deleteDoc: vi.fn(async (...args: Parameters<DocumentService["deleteDoc"]>) => {
        try {
          await refusing.deleteDoc(...args);
        } catch (err) {
          stored.set(args[1], { ...stored.get(args[1])!, modified_by: "editor@example.com" });
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

