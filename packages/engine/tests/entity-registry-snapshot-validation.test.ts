import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

async function loadFixture(entityJson: Record<string, unknown>): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "snap-validation-"));
  await writeFile(join(dir, "x.entity.json"), JSON.stringify(entityJson));
  const registry = new EntityRegistry();
  await registry.loadAll(dir);
  await rm(dir, { recursive: true, force: true });
  return registry;
}

beforeEach(() => warn.mockClear());

const baseInvoice = (override: Record<string, unknown>) => ({
  name: "salesInvoice",
  module: "erp",
  database: "app",
  naming: { strategy: "auto_increment" },
  fields: [
    { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", idx: 1 },
    { fieldname: "customer_company_name", fieldtype: "Data", label: "x", read_only: true, idx: 2 },
    { fieldname: "writable_field", fieldtype: "Data", label: "x", idx: 3 },
    { fieldname: "field_with_fetch_from", fieldtype: "Data", label: "x", read_only: true, fetch_from: "customer.company_name", idx: 4 },
  ],
  permissions: [],
  ...override,
});

describe("entity-registry snapshot validation", () => {
  it("strips manifest when `from` references unknown field", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "phantom", fields: { customer_company_name: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips manifest when `from` is not a Link", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "writable_field", fields: { customer_company_name: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips manifest when target field is not declared", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "customer", fields: { phantom_field: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips manifest when target field is not read_only", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "customer", fields: { writable_field: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips manifest when target field also declares fetch_from", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "customer", fields: { field_with_fetch_from: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("accepts a valid manifest", async () => {
    const r = await loadFixture(
      baseInvoice({
        snapshot: [{ from: "customer", fields: { customer_company_name: "company_name" } }],
      }),
    );
    expect(r.get("salesInvoice").snapshot).toEqual([
      { from: "customer", fields: { customer_company_name: "company_name" } },
    ]);
  });

  it("strips manifest entry whose target collides with freeze output (`<base>_snapshot`)", async () => {
    const r = await loadFixture(
      baseInvoice({
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", freeze: true, idx: 1 },
          { fieldname: "customer_snapshot", fieldtype: "Data", label: "x", read_only: true, idx: 2 },
        ],
        snapshot: [{ from: "customer", fields: { customer_snapshot: "company_name" } }],
      }),
    );
    // Both the shadow field and the manifest entry are stripped.
    const e = r.get("salesInvoice");
    expect(e.fields.find((f) => f.fieldname === "customer_snapshot")).toBeUndefined();
    expect(e.snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("does NOT strip `<x>_snapshot` field when base `<x>` has no active freeze", async () => {
    const r = await loadFixture(
      baseInvoice({
        fields: [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", idx: 1 },
          { fieldname: "customer_snapshot", fieldtype: "Data", label: "x", read_only: true, idx: 2 },
        ],
      }),
    );
    // No freeze on customer → customer_snapshot is just a regular field, kept.
    const e = r.get("salesInvoice");
    expect(e.fields.find((f) => f.fieldname === "customer_snapshot")).toBeDefined();
  });

  it("strips per-Table child shadow fields when child Link carries freeze", async () => {
    const r = await loadFixture({
      ...baseInvoice({}),
      fields: [
        { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", idx: 1 },
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [
            { fieldname: "product", fieldtype: "Link", label: "Product", target: "product", freeze: true, idx: 1 },
            { fieldname: "product_snapshot", fieldtype: "Data", label: "x", read_only: true, idx: 2 },
          ],
          idx: 5,
        },
      ],
    });
    const lines = r.get("salesInvoice").fields.find((f) => f.fieldname === "lines");
    expect(lines?.child_fields?.find((c) => c.fieldname === "product_snapshot")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("validates per-Table manifests against child_fields", async () => {
    const r = await loadFixture({
      ...baseInvoice({}),
      fields: [
        { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "customer", idx: 1 },
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          snapshot: [{ from: "phantom_child", fields: { product_name: "name" } }],
          child_fields: [
            { fieldname: "product", fieldtype: "Link", label: "Product", target: "product", idx: 1 },
            { fieldname: "product_name", fieldtype: "Data", label: "x", read_only: true, idx: 2 },
          ],
          idx: 5,
        },
      ],
    });
    const lines = r.get("salesInvoice").fields.find((f) => f.fieldname === "lines");
    expect(lines?.snapshot).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
