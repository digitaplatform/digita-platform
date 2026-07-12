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
import { LinkSearchService } from "../src/core/link/link-search-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// These tests cover search MECHANICS; RBAC has its own suite
// (link-search-permissions.test.ts). Administrator bypasses all checks.
const admin: UserContext = { _id: "t", email: "t@test", roles: ["Administrator"] };

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
    {
      fieldname: "addresses",
      fieldtype: "Table",
      label: "Addresses",
      child_fields: [
        { fieldname: "city", fieldtype: "Data", label: "City" },
        { fieldname: "street", fieldtype: "Data", label: "Street" },
      ],
      idx: 3,
    },
  ],
  permissions: [],
} as unknown as EntityDefinition;

const registry = {
  has: (n: string) => n === "customer",
  get: () => customer,
} as never;

function makeDb(rows: Record<string, unknown>[]) {
  return {
    find: vi.fn().mockResolvedValue(rows),
  } as never;
}

describe("LinkSearchService — direct mode (no target_path)", () => {
  it("returns flat {_id, display} rows", async () => {
    const db = makeDb([
      { _id: "CUST-1", name: "Acme GmbH" },
      { _id: "CUST-2", name: "Acme Ltd" },
    ]);
    const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
    const out = await svc.search("customer", "Acme", admin);
    expect(out).toEqual([
      { _id: "CUST-1", display: "Acme GmbH" },
      { _id: "CUST-2", display: "Acme Ltd" },
    ]);
  });
});

describe("LinkSearchService — sub-row mode (target_path)", () => {
  it("expands matching parents into per-row results with composite _id", async () => {
    const db = makeDb([
      {
        _id: "CUST-1",
        name: "Acme GmbH",
        addresses: [
          { _row_id: "row-aaa", city: "Berlin", street: "Main 1" },
          { _row_id: "row-bbb", city: "Munich", street: "High 5" },
        ],
      },
    ]);
    const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
    const out = await svc.search("customer", "Berlin", admin, undefined, 20, "addresses");
    expect(out).toEqual([
      { _id: "CUST-1::row-aaa", display: "Berlin", subtitle: "Acme GmbH" },
      { _id: "CUST-1::row-bbb", display: "Munich", subtitle: "Acme GmbH" },
    ]);
  });

  it("skips rows without a _row_id", async () => {
    const db = makeDb([
      {
        _id: "CUST-1",
        name: "Acme",
        addresses: [
          { city: "NoRowId" }, // legacy row pre-_row_id, must be skipped
          { _row_id: "row-zzz", city: "Bonn" },
        ],
      },
    ]);
    const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
    const out = await svc.search("customer", "", admin, undefined, 20, "addresses");
    expect(out).toEqual([{ _id: "CUST-1::row-zzz", display: "Bonn", subtitle: "Acme" }]);
  });

  it("returns [] when target_path field is not a Table", async () => {
    const db = makeDb([{ _id: "CUST-1", name: "Acme", addresses: [] }]);
    const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
    const out = await svc.search("customer", "x", admin, undefined, 20, "name");
    expect(out).toEqual([]);
  });

  it("respects limit at the row level (not parent level)", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      _row_id: `row-${i}`,
      city: `City-${i}`,
    }));
    const db = makeDb([{ _id: "CUST-1", name: "Acme", addresses: rows }]);
    const svc = new LinkSearchService(registry, db, new PermissionChecker(registry));
    const out = await svc.search("customer", "City", admin, undefined, 3, "addresses");
    expect(out.length).toBe(3);
  });
});
