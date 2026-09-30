import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { GlobalSearchService } from "../src/core/search/global-search-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

const customer: EntityDefinition = {
  name: "customer",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "name",
  in_global_search: true,
  search_fields: ["name"],
  fields: [{ fieldname: "name", fieldtype: "Data", label: "Name", idx: 1 }],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1 }],
} as unknown as EntityDefinition;

const privateNote: EntityDefinition = {
  name: "privatenote",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  in_global_search: true,
  search_fields: ["title"],
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 }],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1, if_owner: true }],
} as unknown as EntityDefinition;

// A portal role's row names `fields` without the title: a search neither shows it nor matches on it.
const contract: EntityDefinition = {
  name: "contract",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  in_global_search: true,
  search_fields: ["title", "code"],
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 },
    { fieldname: "code", fieldtype: "Data", label: "Code", idx: 2 },
  ],
  permissions: [{ role: "Portal", level: 0, select: 1, read: 1, fields: ["code"] }],
} as unknown as EntityDefinition;

const entities: Record<string, EntityDefinition> = { customer, privatenote: privateNote, contract };

const registry = {
  has: (n: string) => n in entities,
  get: (n: string) => {
    const e = entities[n];
    if (!e) throw new Error(`unknown entity ${n}`);
    return e;
  },
  getAll: () => Object.values(entities),
} as never;

const salesUser: UserContext = { _id: "u1", email: "sales@test", roles: ["Sales"] };
const strangerUser: UserContext = { _id: "u2", email: "stranger@test", roles: ["Guest"] };
const adminUser: UserContext = { _id: "u3", email: "admin@test", roles: ["Administrator"] };
const portalUser: UserContext = { _id: "u4", email: "portal@test", roles: ["Portal"] };

function makeService(rows: Record<string, unknown>[]) {
  const db = { find: vi.fn().mockResolvedValue(rows) };
  const svc = new GlobalSearchService(registry, db as never, new PermissionChecker(registry));
  return { svc, db };
}

describe("GlobalSearchService — RBAC + scope + bounded limit", () => {
  it("returns nothing and never queries for a user with no select grant", async () => {
    const { svc, db } = makeService([{ _id: "CUST-1", name: "Acme" }]);
    const out = await svc.search("Acme", strangerUser);
    expect(out).toEqual([]);
    expect(db.find).not.toHaveBeenCalled();
  });

  it("returns rows for a user with select grant", async () => {
    const { svc } = makeService([{ _id: "CUST-1", name: "Acme" }]);
    const out = await svc.search("Acme", salesUser);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((r) => r.entity === "customer")).toBe(true);
  });

  it("narrows an if_owner entity's search filter by owner", async () => {
    const { svc, db } = makeService([]);
    await svc.search("foo", salesUser);
    const anyFilterHasOwner = db.find.mock.calls.some((c) =>
      JSON.stringify((c[1] as { filters: unknown[] }).filters).includes('"owner":"sales@test"'),
    );
    expect(anyFilterHasOwner).toBe(true);
  });

  it("neither matches nor shows a title that the user's rows name no field for", async () => {
    const { svc, db } = makeService([{ _id: "CON-1", title: "Secret merger", code: "C-7" }]);
    const out = await svc.search("merger", portalUser);
    expect(out).toEqual([{ entity: "contract", _id: "CON-1", title: "CON-1" }]);
    expect(db.find).toHaveBeenCalledTimes(1);
    const filters = JSON.stringify((db.find.mock.calls[0]![1] as { filters: unknown[] }).filters);
    expect(filters).not.toContain('"title"');
    expect(filters).toContain('"code"');
  });

  it("lets Administrator bypass and receive rows", async () => {
    const { svc } = makeService([{ _id: "CUST-1", name: "Acme" }]);
    const out = await svc.search("Acme", adminUser);
    expect(out.length).toBeGreaterThan(0);
  });

  it("clamps a huge caller limit so the per-collection fan-out stays bounded", async () => {
    const { svc, db } = makeService([]);
    await svc.search("foo", salesUser, 100000);
    for (const call of db.find.mock.calls) {
      const perCollLimit = (call[1] as { limit: number }).limit;
      expect(perCollLimit).toBeLessThanOrEqual(50);
    }
  });
});
