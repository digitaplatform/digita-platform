import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import {
  SnapshotResolver,
  isFreezeOn,
  getFreezeFlatten,
  entityHasAnyFreeze,
} from "../src/core/snapshot/snapshot-resolver.js";

async function loadFixture(entityJsons: Record<string, unknown>[]): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "flatten-"));
  for (let i = 0; i < entityJsons.length; i++) {
    await writeFile(
      join(dir, `e${i}.entity.json`),
      JSON.stringify(entityJsons[i]),
    );
  }
  const registry = new EntityRegistry();
  await registry.loadAll(dir);
  await rm(dir, { recursive: true, force: true });
  return registry;
}

const customerEntity = () => ({
  name: "Customer",
  module: "erp",
  database: "app",
  naming: { strategy: "user_set" },
  snapshot_fields: ["company_name", "vat_id"],
  fields: [
    { fieldname: "company_name", fieldtype: "Data", label: "Name", idx: 1 },
    { fieldname: "vat_id", fieldtype: "Data", label: "VAT", idx: 2 },
  ],
  permissions: [],
});

const invoiceEntity = (customerFreeze: unknown) => ({
  name: "SalesInvoice",
  module: "erp",
  database: "app",
  naming: { strategy: "auto_increment" },
  is_submittable: true,
  fields: [
    {
      fieldname: "customer", fieldtype: "Link", target: "Customer",
      label: "Customer", idx: 1, freeze: customerFreeze,
    },
  ],
  permissions: [],
});

describe("freeze object form", () => {
  it("isFreezeOn returns true for {flatten:[...]}", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [{ from: "company_name", as: "customer_name_at_invoice" }],
      }),
    ]);
    const link = r.get("SalesInvoice").fields.find((f) => f.fieldname === "customer");
    expect(isFreezeOn(link!)).toBe(true);
    expect(entityHasAnyFreeze(r.get("SalesInvoice"))).toBe(true);
  });

  it("isFreezeOn returns false for {flatten:[]} with no fields/flatten", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({ flatten: [] }),
    ]);
    const link = r.get("SalesInvoice").fields.find((f) => f.fieldname === "customer");
    expect(isFreezeOn(link!)).toBe(false);
  });

  it("getFreezeFlatten extracts the spec list", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [
          { from: "company_name", as: "customer_name_at_invoice" },
          { from: "vat_id", as: "customer_vat_at_invoice" },
        ],
      }),
    ]);
    const link = r.get("SalesInvoice").fields.find((f) => f.fieldname === "customer");
    expect(getFreezeFlatten(link!)).toHaveLength(2);
  });
});

describe("entity-registry: expandFlattenDirectives", () => {
  it("auto-generates flat field declarations from flatten[]", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [
          {
            from: "company_name",
            as: "customer_name_at_invoice",
            label: "Customer (frozen)",
            in_list_view: true,
          },
        ],
      }),
    ]);
    const e = r.get("SalesInvoice");
    const generated = e.fields.find((f) => f.fieldname === "customer_name_at_invoice");
    expect(generated).toBeDefined();
    expect(generated?.read_only).toBe(true);
    expect(generated?.in_list_view).toBe(true);
    expect(generated?.label).toBe("Customer (frozen)");
  });

  it("respects existing hand-declared field — does not duplicate", async () => {
    const r = await loadFixture([
      customerEntity(),
      {
        ...invoiceEntity({
          flatten: [{ from: "company_name", as: "customer_name_at_invoice", label: "Wrong" }],
        }),
        fields: [
          { fieldname: "customer", fieldtype: "Link", target: "Customer", label: "C", idx: 1, freeze: { flatten: [{ from: "company_name", as: "customer_name_at_invoice", label: "Wrong" }] } },
          { fieldname: "customer_name_at_invoice", fieldtype: "Data", label: "Hand", read_only: true, idx: 2 },
        ],
      },
    ]);
    const e = r.get("SalesInvoice");
    const matches = e.fields.filter((f) => f.fieldname === "customer_name_at_invoice");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.label).toBe("Hand"); // hand-declared wins
  });

  it("auto-generates fetch_from when spec.fetch_from is true", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [
          {
            from: "company_name",
            as: "customer_name_at_invoice",
            fetch_from: true,
            fetch_if_empty: true,
          },
        ],
      }),
    ]);
    const generated = r.get("SalesInvoice").fields.find(
      (f) => f.fieldname === "customer_name_at_invoice",
    );
    expect(generated?.fetch_from).toBe("customer.company_name");
    expect(generated?.fetch_if_empty).toBe(true);
  });

  it("auto-creates entity.indexes[] entry when spec.indexed=true", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [
          { from: "company_name", as: "customer_name_at_invoice", indexed: true },
        ],
      }),
    ]);
    const e = r.get("SalesInvoice");
    expect(e.indexes).toContainEqual(
      expect.objectContaining({ name: "idx_customer_name_at_invoice" }),
    );
  });
});

describe("snapshot-resolver: applyFlatten", () => {
  function mockDb(customerDoc: Record<string, unknown>) {
    return {
      find: vi.fn(async (collection: string) => {
        if (collection === "Customer") return [customerDoc];
        return [];
      }),
    };
  }

  it("writes flat fields from linked source at freeze time", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [
          { from: "company_name", as: "customer_name_at_invoice" },
          { from: "vat_id", as: "customer_vat_at_invoice" },
        ],
      }),
    ]);
    const db = mockDb({ _id: "C-1", company_name: "Acme", vat_id: "DE123" });
    const resolver = new SnapshotResolver(r, db as never);
    const out = await resolver.resolve(r.get("SalesInvoice"), { customer: "C-1" });
    expect(out["customer_name_at_invoice"]).toBe("Acme");
    expect(out["customer_vat_at_invoice"]).toBe("DE123");
  });

  it("writes JSON snapshot AND flat fields together", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        flatten: [{ from: "company_name", as: "customer_name_at_invoice" }],
      }),
    ]);
    const db = mockDb({ _id: "C-1", company_name: "Acme", vat_id: "DE123" });
    const resolver = new SnapshotResolver(r, db as never);
    const out = await resolver.resolve(r.get("SalesInvoice"), { customer: "C-1" });
    expect(out["customer_name_at_invoice"]).toBe("Acme");
    // JSON snapshot uses target's snapshot_fields (company_name, vat_id).
    expect(out["customer_snapshot"]).toEqual({ company_name: "Acme", vat_id: "DE123" });
  });

  it("flatten with explicit fields list overrides target snapshot_fields", async () => {
    const r = await loadFixture([
      customerEntity(),
      invoiceEntity({
        fields: ["company_name"],
        flatten: [{ from: "company_name", as: "customer_name_at_invoice" }],
      }),
    ]);
    const db = mockDb({ _id: "C-1", company_name: "Acme", vat_id: "DE123" });
    const resolver = new SnapshotResolver(r, db as never);
    const out = await resolver.resolve(r.get("SalesInvoice"), { customer: "C-1" });
    expect(out["customer_snapshot"]).toEqual({ company_name: "Acme" });
    expect(out["customer_name_at_invoice"]).toBe("Acme");
  });
});

describe("snapshot-resolver: target_path sub-row freeze + flatten", () => {
  // Sub-row freeze targets a row inside a parent doc's child Table.
  // The source for both the JSON snapshot AND any flatten[] entries is
  // the sub-row itself, identified by the composite link `<parent>::<row>`.
  function customerWithAddressTable() {
    return {
      name: "Customer",
      module: "erp",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [
        { fieldname: "company_name", fieldtype: "Data", label: "Name", idx: 1 },
        {
          fieldname: "addresses",
          fieldtype: "Table",
          label: "Addresses",
          idx: 2,
          child_fields: [
            { fieldname: "street", fieldtype: "Data", label: "Street", idx: 1 },
            { fieldname: "city", fieldtype: "Data", label: "City", idx: 2 },
            { fieldname: "country", fieldtype: "Data", label: "Country", idx: 3 },
          ],
        },
      ],
      permissions: [],
    };
  }

  function invoiceWithBillingAddress(billingFreeze: unknown) {
    return {
      name: "SalesInvoice",
      module: "erp",
      database: "app",
      naming: { strategy: "auto_increment" },
      is_submittable: true,
      fields: [
        {
          fieldname: "billing_address",
          fieldtype: "Link",
          target: "Customer",
          target_path: "addresses",
          label: "Billing address",
          idx: 1,
          freeze: billingFreeze,
        },
      ],
      permissions: [],
    };
  }

  it("flatten[] reads from the sub-row, not the parent doc", async () => {
    const r = await loadFixture([
      customerWithAddressTable(),
      invoiceWithBillingAddress({
        flatten: [
          { from: "city", as: "billing_city_at_invoice" },
          { from: "country", as: "billing_country_at_invoice" },
        ],
      }),
    ]);
    // Customer doc with two address rows (same _row_id mapping the
    // composite link uses internally).
    const customerDoc = {
      _id: "ACME",
      company_name: "Acme",
      addresses: [
        { _row_id: "ROW1", street: "1 Main", city: "Berlin", country: "DE" },
        { _row_id: "ROW2", street: "2 High", city: "Munich", country: "DE" },
      ],
    };
    const db = {
      find: vi.fn(async (collection: string) => {
        if (collection === "Customer") return [customerDoc];
        return [];
      }),
    };
    const resolver = new SnapshotResolver(r, db as never);
    const out = await resolver.resolve(r.get("SalesInvoice"), {
      // Composite link: the parent id, then the row id.
      billing_address: "ACME::ROW1",
    });
    expect(out["billing_city_at_invoice"]).toBe("Berlin");
    expect(out["billing_country_at_invoice"]).toBe("DE");
    // JSON snapshot for sub-row freeze copies the whole row (minus
    // _row_id book-keeping).
    expect(out["billing_address_snapshot"]).toEqual({
      street: "1 Main",
      city: "Berlin",
      country: "DE",
    });
  });

  it("picks the correct sub-row when multiple exist", async () => {
    const r = await loadFixture([
      customerWithAddressTable(),
      invoiceWithBillingAddress({
        flatten: [{ from: "city", as: "billing_city_at_invoice" }],
      }),
    ]);
    const customerDoc = {
      _id: "ACME",
      addresses: [
        { _row_id: "R1", city: "Berlin" },
        { _row_id: "R2", city: "Munich" },
      ],
    };
    const db = {
      find: vi.fn(async () => [customerDoc]),
    };
    const resolver = new SnapshotResolver(r, db as never);
    const out = await resolver.resolve(r.get("SalesInvoice"), {
      billing_address: "ACME::R2",
    });
    expect(out["billing_city_at_invoice"]).toBe("Munich");
  });
});
