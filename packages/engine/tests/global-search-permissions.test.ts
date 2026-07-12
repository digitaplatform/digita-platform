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

const entities: Record<string, EntityDefinition> = { customer, privatenote: privateNote };

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
