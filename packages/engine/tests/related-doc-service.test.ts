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
import { RelatedDocService } from "../src/core/related/related-doc-service.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

// The linked (counted) entity: only an if_owner-restricted read for Sales.
const salesInvoice: EntityDefinition = {
  name: "SalesInvoice",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "product", fieldtype: "Data", label: "Product", idx: 1 }],
  permissions: [{ role: "Sales", level: 0, select: 1, read: 1, if_owner: true }],
} as unknown as EntityDefinition;

const parentEntity: EntityDefinition = {
  name: "Product",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [],
  permissions: [],
  links: [
    { entity: "SalesInvoice", link_field: "lines.product", label: "Invoices", show_count: true },
  ],
} as unknown as EntityDefinition;

const entities: Record<string, EntityDefinition> = { SalesInvoice: salesInvoice, Product: parentEntity };

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

function makeService() {
  const db = { count: vi.fn().mockResolvedValue(7) };
  const svc = new RelatedDocService(registry, db as never, new PermissionChecker(registry));
  return { svc, db };
}

describe("RelatedDocService.getRelatedDocs — authorizes the counted entity", () => {
  it("returns count 0 and never counts for a user with no select grant", async () => {
    const { svc, db } = makeService();
    const out = await svc.getRelatedDocs(parentEntity, "PROD-1", strangerUser);
    expect(out[0]!.count).toBe(0);
    expect(db.count).not.toHaveBeenCalled();
  });

  it("narrows the count filter by owner for an if_owner-restricted linked entity", async () => {
    const { svc, db } = makeService();
    await svc.getRelatedDocs(parentEntity, "PROD-1", salesUser);
    expect(db.count).toHaveBeenCalledTimes(1);
    const filterArg = db.count.mock.calls[0]![1];
    const asJson = JSON.stringify(filterArg);
    expect(asJson).toContain('"owner":"sales@test"');
    expect(asJson).toContain('"lines.product":"PROD-1"');
  });

  it("counts for an Administrator (bypass) without scope narrowing", async () => {
    const { svc, db } = makeService();
    const out = await svc.getRelatedDocs(parentEntity, "PROD-1", adminUser);
    expect(db.count).toHaveBeenCalledTimes(1);
    expect(out[0]!.count).toBe(7);
  });

  it("returns count 0 when no user is provided (fail closed)", async () => {
    const { svc, db } = makeService();
    const out = await svc.getRelatedDocs(parentEntity, "PROD-1");
    expect(out[0]!.count).toBe(0);
    expect(db.count).not.toHaveBeenCalled();
  });
});
