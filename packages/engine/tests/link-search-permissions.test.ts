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
import {
  PermissionChecker,
  PermissionDeniedError,
} from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// Entity with role-gated select + one perm_level-1 field (readable only via a
// level-1 permission, which no role here has) — the link search must not leak it.
const customer: EntityDefinition = {
  name: "customer",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "name",
  search_fields: ["name", "vat_id"],
  fields: [
    { fieldname: "name", fieldtype: "Data", label: "Name", idx: 1 },
    { fieldname: "vat_id", fieldtype: "Data", label: "VAT", idx: 2 },
    { fieldname: "secret_margin", fieldtype: "Data", label: "Margin", perm_level: 1, idx: 3 },
  ],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1 }],
} as unknown as EntityDefinition;

// Entity whose only read permission is if_owner-restricted — the search filter
// must carry the owner narrowing so other users' rows can't be enumerated.
const privateNote: EntityDefinition = {
  name: "privatenote",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  title_field: "title",
  search_fields: ["title"],
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", idx: 1 }],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1, if_owner: true }],
} as unknown as EntityDefinition;

const entities: Record<string, EntityDefinition> = {
  customer,
  privatenote: privateNote,
};

const registry = {
  has: (n: string) => n in entities,
  get: (n: string) => {
    const e = entities[n];
    if (!e) throw new Error(`unknown entity ${n}`);
    return e;
  },
} as never;

const salesUser: UserContext = { _id: "u1", email: "sales@test", roles: ["Sales"] };
const strangerUser: UserContext = { _id: "u2", email: "stranger@test", roles: ["Guest"] };
const adminUser: UserContext = { _id: "u3", email: "admin@test", roles: ["Administrator"] };

function makeDb(rows: Record<string, unknown>[]) {
  return { find: vi.fn().mockResolvedValue(rows) } as never;
}

function makeService(rows: Record<string, unknown>[]) {
  const db = makeDb(rows);
  const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
  return { svc, db: db as unknown as { find: ReturnType<typeof vi.fn> } };
}

describe("LinkSearchService — RBAC", () => {
  it("allows a role with select permission", async () => {
    const { svc } = makeService([{ _id: "CUST-1", name: "Acme GmbH" }]);
    const out = await svc.search("customer", "Acme", salesUser);
    expect(out).toEqual([{ _id: "CUST-1", display: "Acme GmbH" }]);
  });

  it("rejects a user without select permission", async () => {
    const { svc, db } = makeService([{ _id: "CUST-1", name: "Acme GmbH" }]);
    await expect(svc.search("customer", "Acme", strangerUser)).rejects.toThrow(
      PermissionDeniedError,
    );
    expect(db.find).not.toHaveBeenCalled();
  });

  it("lets Administrator bypass", async () => {
    const { svc } = makeService([{ _id: "CUST-1", name: "Acme GmbH" }]);
    const out = await svc.search("customer", "Acme", adminUser);
    expect(out).toHaveLength(1);
  });

  it("applies if_owner scope narrowing to the search filter", async () => {
    const { svc, db } = makeService([]);
    await svc.search("privatenote", "foo", salesUser);
    const passedQuery = db.find.mock.calls[0]![1] as { filters: Record<string, unknown>[] };
    expect(JSON.stringify(passedQuery.filters)).toContain('"owner":"sales@test"');
  });

  it("strips unknown and perm_level-gated columns from search-dialog fields", async () => {
    const { svc, db } = makeService([
      { _id: "CUST-1", name: "Acme GmbH", vat_id: "DE1", secret_margin: "33%" },
    ]);
    const out = await svc.search("customer", "Acme", salesUser, undefined, 20, undefined, [
      "vat_id",
      "secret_margin",
      "does_not_exist",
    ]);
    expect(out[0]!.fields).toEqual({ vat_id: "DE1" });
    // The projection sent to the DB must not request unknown columns either.
    const passedQuery = db.find.mock.calls[0]![1] as { fields: string[] };
    expect(passedQuery.fields).not.toContain("does_not_exist");
  });

  it("enforces the same select check in sub-row (target_path) mode", async () => {
    const { svc, db } = makeService([]);
    await expect(
      svc.search("customer", "Berlin", strangerUser, undefined, 20, "addresses"),
    ).rejects.toThrow(PermissionDeniedError);
    expect(db.find).not.toHaveBeenCalled();
  });
});
