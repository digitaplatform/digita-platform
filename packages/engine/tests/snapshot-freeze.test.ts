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
import { SnapshotResolver } from "../src/core/snapshot/snapshot-resolver.js";

function makeRegistry(entities: Record<string, EntityDefinition>) {
  return {
    has: (n: string) => n in entities,
    get: (n: string) => {
      const e = entities[n];
      if (!e) throw new Error(`Unknown entity ${n}`);
      return e;
    },
  } as never;
}

function customer(): EntityDefinition {
  return {
    name: "Customer",
    module: "test",
    database: "erp_master",
    naming: { strategy: "user_set" },
    snapshot_fields: ["company_name", "vat_id", "email"],
    fields: [
      { fieldname: "company_name", fieldtype: "Data", label: "Name" },
      { fieldname: "vat_id", fieldtype: "Data", label: "VAT" },
      { fieldname: "email", fieldtype: "Data", label: "Email" },
      { fieldname: "credit_limit", fieldtype: "Currency", label: "Credit Limit" },
      {
        fieldname: "addresses",
        fieldtype: "Table",
        label: "Addresses",
        child_fields: [
          { fieldname: "street", fieldtype: "Data", label: "Street" },
          { fieldname: "city", fieldtype: "Data", label: "City" },
          { fieldname: "postal_code", fieldtype: "Data", label: "PLZ" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

function product(): EntityDefinition {
  return {
    name: "Product",
    module: "test",
    database: "erp_master",
    naming: { strategy: "user_set" },
    snapshot_fields: ["title", "sku"],
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "sku", fieldtype: "Data", label: "SKU" },
      { fieldname: "current_stock", fieldtype: "Int", label: "Stock" },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

function salesInvoice(): EntityDefinition {
  return {
    name: "SalesInvoice",
    module: "test",
    database: "erp_sales",
    is_submittable: true,
    naming: { strategy: "auto_increment" },
    fields: [
      {
        fieldname: "customer",
        fieldtype: "Link",
        label: "Customer",
        target: "Customer",
        freeze: true,
      },
      {
        fieldname: "billing_address",
        fieldtype: "Link",
        label: "Billing Address",
        target: "Customer",
        target_path: "addresses",
        freeze: true,
      },
      {
        fieldname: "vat_id_only_link",
        fieldtype: "Link",
        label: "VAT Source",
        target: "Customer",
        freeze: ["vat_id"], // override list
      },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          {
            fieldname: "product",
            fieldtype: "Link",
            label: "Product",
            target: "Product",
            freeze: true,
          },
          { fieldname: "quantity", fieldtype: "Int", label: "Qty" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

describe("SnapshotResolver — field-level freeze directive", () => {
  it("freezes target's snapshot_fields into <fieldname>_snapshot on submit", async () => {
    const registry = makeRegistry({
      Customer: customer(),
      Product: product(),
      SalesInvoice: salesInvoice(),
    });
    const find = vi.fn().mockImplementation(async (collection: string) => {
      if (collection === "Customer") {
        return [
          {
            _id: "CUST-1",
            company_name: "Müller GmbH",
            vat_id: "DE123",
            email: "billing@mueller.de",
            credit_limit: 50000, // operational, must NOT leak in
            addresses: [
              { _row_id: "row-aaa", street: "Hauptstr. 1", city: "Berlin", postal_code: "10115" },
            ],
          },
        ];
      }
      if (collection === "Product") {
        return [{ _id: "P-1", title: "Premium Widget", sku: "WGT-001", current_stock: 999 }];
      }
      return [];
    });
    const db = { find } as never;
    const resolver = new SnapshotResolver(registry, db);

    const out = await resolver.resolve(salesInvoice(), {
      customer: "CUST-1",
      billing_address: "CUST-1::row-aaa",
      vat_id_only_link: "CUST-1",
      lines: [{ product: "P-1", quantity: 5 }],
    });

    // Plain Link freeze: copies declared snapshot_fields, NOT operational ones.
    expect(out.customer_snapshot).toEqual({
      company_name: "Müller GmbH",
      vat_id: "DE123",
      email: "billing@mueller.de",
    });
    expect((out.customer_snapshot as Record<string, unknown>).credit_limit).toBeUndefined();

    // Sub-row Link (target_path): copies entire row minus _row_id.
    expect(out.billing_address_snapshot).toEqual({
      street: "Hauptstr. 1",
      city: "Berlin",
      postal_code: "10115",
    });
    expect((out.billing_address_snapshot as Record<string, unknown>)._row_id).toBeUndefined();

    // Override list: copies exactly the listed fields.
    expect(out.vat_id_only_link_snapshot).toEqual({ vat_id: "DE123" });

    // Child-table Link freeze: per-row snapshot.
    expect(out.lines).toEqual([
      {
        product: "P-1",
        quantity: 5,
        product_snapshot: { title: "Premium Widget", sku: "WGT-001" },
      },
    ]);
  });

  it("treats freeze: false as opt-out — no snapshot field written", async () => {
    const entity = salesInvoice();
    const customerField = entity.fields.find((f) => f.fieldname === "customer");
    if (!customerField) throw new Error("test fixture broken");
    customerField.freeze = false; // explicit opt-out

    const registry = makeRegistry({
      Customer: customer(),
      Product: product(),
      SalesInvoice: entity,
    });
    const find = vi.fn().mockResolvedValue([]);
    const db = { find } as never;
    const resolver = new SnapshotResolver(registry, db);

    const out = await resolver.resolve(entity, {
      customer: "CUST-1",
    });

    expect(out.customer_snapshot).toBeUndefined();
  });

  it("writes empty snapshot when target declares no snapshot_fields and freeze is true", async () => {
    const masterWithoutFields = customer();
    delete (masterWithoutFields as { snapshot_fields?: string[] }).snapshot_fields;
    const registry = makeRegistry({
      Customer: masterWithoutFields,
      Product: product(),
      SalesInvoice: salesInvoice(),
    });
    const find = vi.fn().mockImplementation(async (collection: string) => {
      if (collection === "Customer") {
        return [{ _id: "CUST-1", company_name: "Müller", addresses: [] }];
      }
      if (collection === "Product") {
        return [{ _id: "P-1", title: "X", sku: "X" }];
      }
      return [];
    });
    const db = { find } as never;
    const resolver = new SnapshotResolver(registry, db);

    const out = await resolver.resolve(salesInvoice(), {
      customer: "CUST-1",
      lines: [],
    });

    // Empty object is the safe fallback when the master forgot to declare.
    expect(out.customer_snapshot).toEqual({});
  });

  it("writes nothing when the link value itself is empty", async () => {
    const registry = makeRegistry({
      Customer: customer(),
      Product: product(),
      SalesInvoice: salesInvoice(),
    });
    const find = vi.fn().mockResolvedValue([]);
    const db = { find } as never;
    const resolver = new SnapshotResolver(registry, db);

    const out = await resolver.resolve(salesInvoice(), {
      customer: "",
      lines: [],
    });

    expect(out.customer_snapshot).toBeUndefined();
  });
});
