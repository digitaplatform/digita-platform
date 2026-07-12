import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import {
  SnapshotResolver,
  SnapshotMissingTargetError,
  entityHasAnySnapshot,
} from "../src/core/snapshot/snapshot-resolver.js";

function customerEntity(): EntityDefinition {
  return {
    name: "customer",
    module: "erp",
    database: "app",
    naming: { strategy: "auto_increment" },
    fields: [],
    permissions: [],
  } as unknown as EntityDefinition;
}

function invoiceEntity(): EntityDefinition {
  return {
    name: "salesInvoice",
    module: "erp",
    database: "app",
    naming: { strategy: "auto_increment" },
    snapshot: [
      {
        from: "customer",
        fields: {
          customer_company_name: "company_name",
          customer_vat_id: "vat_id",
          customer_country: "address.country",
        },
      },
    ],
    fields: [
      { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer" },
      { fieldname: "customer_company_name", fieldtype: "Data", label: "x", read_only: true },
      { fieldname: "customer_vat_id", fieldtype: "Data", label: "x", read_only: true },
      { fieldname: "customer_country", fieldtype: "Data", label: "x", read_only: true },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        snapshot: [
          { from: "product", fields: { product_name: "name", product_number: "product_number" } },
        ],
        child_fields: [
          { fieldname: "product", fieldtype: "Link", label: "Product", target: "product" },
          { fieldname: "product_name", fieldtype: "Data", label: "x", read_only: true },
          { fieldname: "product_number", fieldtype: "Data", label: "x", read_only: true },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

function makeRegistry(byName: Record<string, EntityDefinition>) {
  return {
    has: (n: string) => n in byName,
    get: (n: string) => {
      const e = byName[n];
      if (!e) throw new Error(`Entity ${n} not in registry`);
      return e;
    },
  };
}

interface FindCall { collection: string; filters: unknown; }

function makeDb(rows: Record<string, Array<Record<string, unknown>>>): {
  find: ReturnType<typeof vi.fn>;
  calls: FindCall[];
} {
  const calls: FindCall[] = [];
  const find = vi.fn(async (collection: string, options: { filters?: unknown[] }) => {
    calls.push({ collection, filters: options.filters });
    const ids = ((options.filters?.[0] as Record<string, unknown> | undefined)?.["_id"] as { $in?: string[] } | undefined)?.$in ?? [];
    return (rows[collection] ?? []).filter((r) => ids.includes(String(r["_id"])));
  });
  return { find, calls };
}

describe("entityHasAnySnapshot", () => {
  it("false when no manifests anywhere", () => {
    const e: EntityDefinition = {
      name: "x", module: "erp", database: "app", naming: { strategy: "auto_increment" },
      fields: [], permissions: [],
    } as unknown as EntityDefinition;
    expect(entityHasAnySnapshot(e)).toBe(false);
  });
  it("true when top-level manifest present", () => {
    expect(entityHasAnySnapshot(invoiceEntity())).toBe(true);
  });
  it("true when only per-Table manifest present", () => {
    const e = invoiceEntity();
    delete e.snapshot;
    expect(entityHasAnySnapshot(e)).toBe(true);
  });
});

describe("SnapshotResolver — happy path", () => {
  it("populates declared fields from a linked doc", async () => {
    const registry = makeRegistry({ customer: customerEntity(), product: { ...customerEntity(), name: "product" } as EntityDefinition });
    const { find } = makeDb({
      customer: [{ _id: "CUST-1", company_name: "Acme GmbH", vat_id: "DE123", address: { country: "DE" } }],
    });
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    const out = await resolver.resolve(invoiceEntity(), { customer: "CUST-1", lines: [] });
    expect(out["customer_company_name"]).toBe("Acme GmbH");
    expect(out["customer_vat_id"]).toBe("DE123");
    expect(out["customer_country"]).toBe("DE");
  });

  it("populates per-line product fields", async () => {
    const productEntity = { ...customerEntity(), name: "product" } as EntityDefinition;
    const registry = makeRegistry({ customer: customerEntity(), product: productEntity });
    const { find } = makeDb({
      customer: [{ _id: "CUST-1", company_name: "Acme GmbH" }],
      product: [
        { _id: "PROD-A", name: "Widget", product_number: "W-001" },
        { _id: "PROD-B", name: "Gadget", product_number: "G-001" },
      ],
    });
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    const out = await resolver.resolve(invoiceEntity(), {
      customer: "CUST-1",
      lines: [
        { product: "PROD-A", quantity: 1 },
        { product: "PROD-B", quantity: 2 },
      ],
    });
    const lines = out["lines"] as Array<Record<string, unknown>>;
    expect(lines[0]!["product_name"]).toBe("Widget");
    expect(lines[0]!["product_number"]).toBe("W-001");
    expect(lines[1]!["product_name"]).toBe("Gadget");
  });
});

describe("SnapshotResolver — null Link handling", () => {
  it("skips silently when Link is null/empty", async () => {
    const registry = makeRegistry({ customer: customerEntity(), product: { ...customerEntity(), name: "product" } as EntityDefinition });
    const { find } = makeDb({});
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    const out = await resolver.resolve(invoiceEntity(), { customer: null, lines: [] });
    expect(out["customer_company_name"]).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });
});

describe("SnapshotResolver — missing target", () => {
  it("throws SnapshotMissingTargetError when Link points at nothing", async () => {
    const registry = makeRegistry({ customer: customerEntity(), product: { ...customerEntity(), name: "product" } as EntityDefinition });
    const { find } = makeDb({ customer: [] }); // no rows
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    await expect(
      resolver.resolve(invoiceEntity(), { customer: "MISSING", lines: [] }),
    ).rejects.toBeInstanceOf(SnapshotMissingTargetError);
  });
});

describe("SnapshotResolver — batching", () => {
  it("two lines on the same product result in ONE find call for that collection", async () => {
    const productEntity = { ...customerEntity(), name: "product" } as EntityDefinition;
    const registry = makeRegistry({ customer: customerEntity(), product: productEntity });
    const { find, calls } = makeDb({
      customer: [{ _id: "CUST-1", company_name: "Acme GmbH" }],
      product: [{ _id: "PROD-A", name: "Widget", product_number: "W-001" }],
    });
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    await resolver.resolve(invoiceEntity(), {
      customer: "CUST-1",
      lines: [
        { product: "PROD-A", quantity: 1 },
        { product: "PROD-A", quantity: 2 },
        { product: "PROD-A", quantity: 3 },
      ],
    });
    const productCalls = calls.filter((c) => c.collection === "product");
    expect(productCalls.length).toBe(1);
  });
});

describe("SnapshotResolver — no-op", () => {
  it("returns input unchanged when entity declares no manifests", async () => {
    const e = customerEntity();
    const registry = makeRegistry({ customer: e });
    const { find } = makeDb({});
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    const out = await resolver.resolve(e, { x: 1 });
    expect(out).toEqual({ x: 1 });
    expect(find).not.toHaveBeenCalled();
  });
});

describe("SnapshotResolver — overwrite semantics", () => {
  it("overwrites a stale snapshot value with the linked doc's current value", async () => {
    const registry = makeRegistry({ customer: customerEntity(), product: { ...customerEntity(), name: "product" } as EntityDefinition });
    const { find } = makeDb({
      customer: [{ _id: "CUST-1", company_name: "NEW NAME", vat_id: "DE-NEW", address: { country: "DE" } }],
    });
    const resolver = new SnapshotResolver(registry as never, { find } as never);
    const out = await resolver.resolve(invoiceEntity(), {
      customer: "CUST-1",
      customer_company_name: "OLD NAME",
      customer_vat_id: "DE-OLD",
      lines: [],
    });
    expect(out["customer_company_name"]).toBe("NEW NAME");
    expect(out["customer_vat_id"]).toBe("DE-NEW");
  });
});
