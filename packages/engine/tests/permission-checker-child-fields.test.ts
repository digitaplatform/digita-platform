import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { PermissionChecker } from "../src/core/permissions/permission-checker.js";
import type { UserContext } from "../src/core/permissions/types.js";

function entityWithGatedChildField(): EntityDefinition {
  return {
    name: "Invoice",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer" },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "product", fieldtype: "Link", label: "Product", target: "product" },
          { fieldname: "qty", fieldtype: "Float", label: "Qty" },
          { fieldname: "cost_price", fieldtype: "Float", label: "Cost Price", perm_level: 2 },
        ],
      },
    ],
    permissions: [
      { role: "Manager", level: 0, select: 1, read: 1, write: 1, create: 1, delete: 1 },
      { role: "Manager", level: 2, read: 1 },
      { role: "Salesperson", level: 0, select: 1, read: 1 },
    ],
  } as unknown as EntityDefinition;
}

function makeChecker(): PermissionChecker {
  const registry = new EntityRegistry();
  registry.register(entityWithGatedChildField());
  return new PermissionChecker(registry);
}

describe("PermissionChecker — child-field perm_level", () => {
  it("Administrator sees every child field (returns null)", () => {
    const checker = makeChecker();
    const admin: UserContext = { _id: "a", email: "a", roles: [SYSTEM_ROLES.ADMINISTRATOR] };
    const allowed = checker.getReadableChildFields(admin, "Invoice", "lines");
    expect(allowed).toBeNull();
  });

  it("Manager (level-2) sees cost_price", () => {
    const checker = makeChecker();
    const manager: UserContext = { _id: "m", email: "m", roles: ["Manager"] };
    const allowed = checker.getReadableChildFields(manager, "Invoice", "lines");
    expect(allowed?.has("cost_price")).toBe(true);
    expect(allowed?.has("product")).toBe(true);
    expect(allowed?.has("qty")).toBe(true);
  });

  it("Salesperson (level-0 only) does NOT see cost_price", () => {
    const checker = makeChecker();
    const sales: UserContext = { _id: "s", email: "s", roles: ["Salesperson"] };
    const allowed = checker.getReadableChildFields(sales, "Invoice", "lines");
    expect(allowed?.has("cost_price")).toBe(false);
    expect(allowed?.has("product")).toBe(true);
    expect(allowed?.has("qty")).toBe(true);
    // _row_id and idx always present
    expect(allowed?.has("_row_id")).toBe(true);
    expect(allowed?.has("idx")).toBe(true);
  });

  it("returns null when no child field is gated", () => {
    const e = entityWithGatedChildField();
    // strip the perm_level
    const gated = e.fields.find((f) => f.fieldname === "lines")!;
    delete (gated.child_fields![2] as { perm_level?: number }).perm_level;
    const registry = new EntityRegistry();
    registry.register(e);
    const checker = new PermissionChecker(registry);
    const sales: UserContext = { _id: "s", email: "s", roles: ["Salesperson"] };
    expect(checker.getReadableChildFields(sales, "Invoice", "lines")).toBeNull();
  });

  it("filterFieldsForRead masks gated child fields per row", () => {
    const checker = makeChecker();
    const sales: UserContext = { _id: "s", email: "s", roles: ["Salesperson"] };
    const data = {
      _id: "INV-1",
      customer: "CUST-1",
      lines: [
        { _row_id: "r1", idx: 0, product: "P-1", qty: 2, cost_price: 100 },
        { _row_id: "r2", idx: 1, product: "P-2", qty: 1, cost_price: 50 },
      ],
    };
    const filtered = checker.filterFieldsForRead(sales, "Invoice", data);
    const lines = filtered["lines"] as Array<Record<string, unknown>>;
    expect(lines[0]!["cost_price"]).toBeUndefined();
    expect(lines[0]!["product"]).toBe("P-1");
    expect(lines[1]!["cost_price"]).toBeUndefined();
    expect(lines[1]!["qty"]).toBe(1);
    // top-level still intact
    expect(filtered["customer"]).toBe("CUST-1");
  });
});
