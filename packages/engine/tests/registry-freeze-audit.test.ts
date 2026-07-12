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
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

function entity(opts: Partial<EntityDefinition> & { name: string }): EntityDefinition {
  return {
    module: "test",
    database: "erp_master",
    naming: { strategy: "user_set" },
    fields: [],
    permissions: [],
    ...opts,
  } as EntityDefinition;
}

describe("EntityRegistry.auditFreezeCoverage", () => {
  it("ignores non-submittable entities", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "Customer",
        is_submittable: false,
        fields: [
          { fieldname: "country", fieldtype: "Link", label: "Country", target: "Country" },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditFreezeCoverage()).toEqual([]);
  });

  it("reports a Link without freeze on a submittable", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesInvoice",
        is_submittable: true,
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer" },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditFreezeCoverage()).toEqual([
      { entity: "SalesInvoice", field: "customer", target: "Customer" },
    ]);
  });

  it("accepts freeze: true as covered", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesInvoice",
        is_submittable: true,
        fields: [
          {
            fieldname: "customer",
            fieldtype: "Link",
            label: "Customer",
            target: "Customer",
            freeze: true,
          },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditFreezeCoverage()).toEqual([]);
  });

  it("accepts freeze: false as explicit opt-out (still covered)", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesInvoice",
        is_submittable: true,
        fields: [
          {
            fieldname: "company",
            fieldtype: "Link",
            label: "Company",
            target: "Company",
            freeze: false, // tenant scope, not a display field
          },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditFreezeCoverage()).toEqual([]);
  });

  it("accepts a Link covered by entity-level snapshot[] manifest", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesOrder",
        is_submittable: true,
        snapshot: [
          {
            from: "customer",
            fields: { customer_company_name_at_order: "company_name" },
          },
        ],
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer" },
          // No freeze here — but covered by entity-level manifest.
        ],
      }),
    );
    expect(reg.auditFreezeCoverage()).toEqual([]);
  });

  it("reports child-table Link fields without freeze on submittable parent", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesInvoice",
        is_submittable: true,
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer", freeze: true },
          {
            fieldname: "lines",
            fieldtype: "Table",
            label: "Lines",
            child_fields: [
              { fieldname: "product", fieldtype: "Link", label: "Product", target: "Product" },
              { fieldname: "tax_rate", fieldtype: "Link", label: "Tax", target: "TaxRate", freeze: true },
            ],
          },
        ],
      } as EntityDefinition),
    );
    expect(reg.auditFreezeCoverage()).toEqual([
      { entity: "SalesInvoice.lines", field: "product", target: "Product" },
    ]);
  });

it("returns multiple gaps across multiple entities", () => {
    const reg = new EntityRegistry();
    reg.register(
      entity({
        name: "SalesOrder",
        is_submittable: true,
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer" },
        ],
      } as EntityDefinition),
    );
    reg.register(
      entity({
        name: "PurchaseOrder",
        is_submittable: true,
        fields: [
          { fieldname: "supplier", fieldtype: "Link", label: "Supplier", target: "Supplier" },
        ],
      } as EntityDefinition),
    );

    const gaps = reg.auditFreezeCoverage();
    expect(gaps).toHaveLength(2);
    expect(gaps).toEqual(
      expect.arrayContaining([
        { entity: "SalesOrder", field: "customer", target: "Customer" },
        { entity: "PurchaseOrder", field: "supplier", target: "Supplier" },
      ]),
    );
  });
});
