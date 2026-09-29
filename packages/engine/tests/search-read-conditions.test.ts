import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
    PERMISSION_SCOPE_ENABLED: false,
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { LinkSearchService } from "../src/core/link/link-search-service.js";
import { GlobalSearchService } from "../src/core/search/global-search-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import { FilterFieldNotAllowedError } from "../src/core/database/filter-builder.js";
import type { UserContext } from "../src/core/permissions/types.js";

// Sales reads a ticket only while it is not hidden, and its level-1 `note` only
// while it is not closed. Both conditions read `status`, which no search asks for.
const ticket: EntityDefinition = {
  name: "ticket",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  in_global_search: true,
  search_fields: ["title", "note"],
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
    { fieldname: "status", fieldtype: "Data", label: "Status", idx: 2 },
    { fieldname: "note", fieldtype: "Data", label: "Note", perm_level: 1, idx: 3 },
    {
      fieldname: "lines",
      fieldtype: "Table",
      label: "Lines",
      idx: 4,
      child_fields: [
        { fieldname: "label", fieldtype: "Data", label: "Label" },
        { fieldname: "cost", fieldtype: "Data", label: "Cost", perm_level: 1 },
      ],
    },
  ],
  permissions: [
    { role: "Sales", level: 0, select: 1, read: 1, condition: "eval:doc.status != 'hidden'" },
    { role: "Sales", level: 1, select: 0, read: 1, condition: "eval:doc.status != 'closed'" },
  ],
} as unknown as EntityDefinition;

// Sales reads an order only when it owns it; the owner check reads `owner`, which no
// search asks for either.
const order: EntityDefinition = {
  name: "order",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  search_fields: ["title"],
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
    { fieldname: "note", fieldtype: "Data", label: "Note", idx: 2 },
    { fieldname: "rows", fieldtype: "Table", label: "Rows", idx: 3, child_fields: [{ fieldname: "label", fieldtype: "Data", label: "Label" }] },
  ],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1, if_owner: 1 }],
} as unknown as EntityDefinition;

const entities: Record<string, EntityDefinition> = { ticket, order };
const registry = {
  has: (n: string) => n in entities,
  get: (n: string) => {
    const e = entities[n];
    if (!e) throw new Error(`unknown entity ${n}`);
    return e;
  },
  getAll: () => [ticket],
} as never;

const sales: UserContext = { _id: "u1", email: "sales@test", roles: ["Sales"] };
const admin: UserContext = { _id: "u3", email: "admin@test", roles: ["Administrator"] };

const rows = [
  { _id: "T-1", title: "Open ticket", status: "open", note: "n-open", lines: [{ _row_id: "r1", label: "L1", cost: "5" }] },
  { _id: "T-2", title: "Hidden ticket", status: "hidden", note: "n-hidden", lines: [{ _row_id: "r2", label: "L2", cost: "9" }] },
  { _id: "T-3", title: "Closed ticket", status: "closed", note: "n-closed", lines: [] },
];

function services() {
  const db = { find: vi.fn().mockResolvedValue(rows) };
  const checker = new PermissionChecker(registry);
  return {
    db,
    link: new LinkSearchService(registry, db as never, checker),
    global: new GlobalSearchService(registry, db as never, checker),
  };
}

const orFields = (db: { find: ReturnType<typeof vi.fn> }) =>
  JSON.stringify((db.find.mock.calls[0]![1] as { filters: unknown[] }).filters);

describe("Link search answers only rows the user may read, decided on the stored row", () => {
  it("drops a row a read condition hides, reading the stored row", async () => {
    const { link, db } = services();
    const out = await link.search("ticket", "ticket", sales);
    expect(out.map((r) => r._id)).toEqual(["T-1", "T-3"]);
    expect((db.find.mock.calls[0]![1] as { fields?: string[] }).fields).toBeUndefined();
    expect((await services().link.search("ticket", "ticket", admin)).map((r) => r._id)).toEqual(["T-1", "T-2", "T-3"]);
  });

  it("masks picker columns by the stored row's condition, not by the columns asked for", async () => {
    const { link } = services();
    const out = await link.search("ticket", "ticket", sales, undefined, 20, undefined, ["note"]);
    expect(out.find((r) => r._id === "T-1")?.fields).toEqual({ note: "n-open" });
    expect(out.find((r) => r._id === "T-3")?.fields).toEqual({});
  });

  it("matches only on fields the user may filter on, and refuses any other filter key", async () => {
    const { link, db } = services();
    await link.search("ticket", "n-", sales, { status: "open" });
    expect(orFields(db)).toContain('"title"');
    expect(orFields(db)).not.toContain('"note"');
    for (const filters of [{ $where: "sleep(100)" }, { note: "n-closed" }, { "lines.cost": "9" }, { $or: [{ note: "x" }] }]) {
      await expect(services().link.search("ticket", "x", sales, filters), JSON.stringify(filters)).rejects.toBeInstanceOf(
        FilterFieldNotAllowedError,
      );
    }
  });

  it("expands only the rows of parents the user may read, never a masked child field", async () => {
    const { link, db } = services();
    const out = await link.search("ticket", "L", sales, undefined, 20, "lines");
    expect(out).toEqual([{ _id: "T-1::r1", display: "L1", subtitle: "Open ticket" }]);
    expect(orFields(db)).toContain('"lines.label"');
    expect(orFields(db)).not.toContain('"lines.cost"');
  });
});

describe("Global search answers only rows the user may read", () => {
  it("drops a row a read condition hides and matches only on fields the user may filter on", async () => {
    const { global, db } = services();
    const out = await global.search("ticket", sales);
    expect(out.map((r) => r._id)).toEqual(["T-1", "T-3"]);
    expect(orFields(db)).toContain('"title"');
    expect(orFields(db)).not.toContain('"note"');
    expect((await services().global.search("ticket", admin)).map((r) => r._id)).toEqual(["T-1", "T-2", "T-3"]);
  });
});

describe("A search decides an owner-only reader's fields on the stored row", () => {
  const owned = [{ _id: "O-1", owner: "sales@test", title: "Own order", note: "n-own", rows: [{ _row_id: "a", label: "A" }] }];
  // Projects as MongoDB does, so a search that asks for fields gets only those.
  const ownerServices = () => {
    const db = {
      find: vi.fn(async (_name: string, options: { fields?: string[] }) =>
        options.fields
          ? owned.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => options.fields!.includes(key))))
          : owned,
      ),
    };
    return { db, link: new LinkSearchService(registry, db as never, new PermissionChecker(registry)) };
  };

  it("expands the sub-rows of the reader's own document", async () => {
    const { link, db } = ownerServices();
    expect(await link.search("order", "A", sales, undefined, 20, "rows")).toEqual([
      { _id: "O-1::a", display: "A", subtitle: "Own order" },
    ]);
    expect((db.find.mock.calls[0]![1] as { fields?: string[] }).fields).toBeUndefined();
  });

  it("answers the picker columns of the reader's own document", async () => {
    const { link } = ownerServices();
    const out = await link.search("order", "Own", sales, undefined, 20, undefined, ["note"]);
    expect(out).toEqual([{ _id: "O-1", display: "Own order", fields: { note: "n-own" } }]);
  });
});
