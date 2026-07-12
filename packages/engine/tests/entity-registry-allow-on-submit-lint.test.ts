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
import type { EntityDefinition } from "@digitaplatform/shared";

async function loadFixture(entityJson: Record<string, unknown>): Promise<EntityRegistry> {
  const dir = await mkdtemp(join(tmpdir(), "aos-lint-"));
  await writeFile(join(dir, "x.entity.json"), JSON.stringify(entityJson));
  const registry = new EntityRegistry();
  await registry.loadAll(dir);
  await rm(dir, { recursive: true, force: true });
  return registry;
}

function flagOf(r: EntityRegistry, name: string, field: string): boolean | undefined {
  const e = r.get(name) as EntityDefinition;
  return e.fields.find((f) => f.fieldname === field)?.allow_on_submit;
}

const base = (fields: unknown[], override: Record<string, unknown> = {}) => ({
  name: "Doc",
  module: "test",
  database: "app",
  naming: { strategy: "auto_increment" },
  is_submittable: true,
  fields,
  permissions: [],
  ...override,
});

beforeEach(() => warn.mockClear());

describe("entity-registry allow_on_submit lint", () => {
  it("strips the flag on a system field", async () => {
    const r = await loadFixture(
      base([{ fieldname: "owner", fieldtype: "Data", label: "Owner", allow_on_submit: true }]),
    );
    expect(flagOf(r, "Doc", "owner")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips the flag when set_only_once is also set", async () => {
    const r = await loadFixture(
      base([{ fieldname: "code", fieldtype: "Data", label: "Code", set_only_once: true, allow_on_submit: true }]),
    );
    expect(flagOf(r, "Doc", "code")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips the flag on a field with an active freeze", async () => {
    const r = await loadFixture(
      base([
        { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer", freeze: true, allow_on_submit: true },
      ]),
    );
    expect(flagOf(r, "Doc", "customer")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips the flag on a snapshot-manifest target field", async () => {
    const r = await loadFixture(
      base(
        [
          { fieldname: "customer", fieldtype: "Link", label: "Customer", target: "Customer" },
          { fieldname: "cust_name", fieldtype: "Data", label: "Name", read_only: true, allow_on_submit: true },
        ],
        { snapshot: [{ from: "customer", fields: { cust_name: "company_name" } }] },
      ),
    );
    expect(flagOf(r, "Doc", "cust_name")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("strips the flag on an Attach field", async () => {
    const r = await loadFixture(
      base([
        { fieldname: "file", fieldtype: "Attach", label: "File", storage_path: "docs", allow_on_submit: true },
      ]),
    );
    expect(flagOf(r, "Doc", "file")).toBeUndefined();
  });

  it("strips the flag on a layout fieldtype", async () => {
    const r = await loadFixture(
      base([{ fieldname: "sb", fieldtype: "SectionBreak", label: "Section", allow_on_submit: true }]),
    );
    expect(flagOf(r, "Doc", "sb")).toBeUndefined();
  });

  it("KEEPS a valid flag on a plain stored field", async () => {
    const r = await loadFixture(
      base([{ fieldname: "amount_paid", fieldtype: "Currency", label: "Paid", allow_on_submit: true }]),
    );
    expect(flagOf(r, "Doc", "amount_paid")).toBe(true);
  });

  it("strips an invalid child cell flag but keeps a valid one", async () => {
    const r = await loadFixture(
      base([
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [
            { fieldname: "code", fieldtype: "Data", label: "Code", set_only_once: true, allow_on_submit: true },
            { fieldname: "delivered", fieldtype: "Float", label: "Delivered", allow_on_submit: true },
          ],
        },
      ]),
    );
    const table = (r.get("Doc") as EntityDefinition).fields.find((f) => f.fieldname === "lines");
    const cells = table?.child_fields ?? [];
    expect(cells.find((c) => c.fieldname === "code")?.allow_on_submit).toBeUndefined();
    expect(cells.find((c) => c.fieldname === "delivered")?.allow_on_submit).toBe(true);
  });

  it("warns (advisory) when a doc_status-1 transition side_effect targets a non-band field", async () => {
    await loadFixture(
      base(
        [
          { fieldname: "status", fieldtype: "Select", label: "Status", options: ["a", "b"] },
          { fieldname: "frozen_note", fieldtype: "Data", label: "Note" }, // NOT band
          { fieldname: "delivered_at", fieldtype: "Datetime", label: "At", allow_on_submit: true },
        ],
        {
          workflow_field: "status",
          states: [
            { value: "a", doc_status: 1 },
            { value: "b", doc_status: 1 },
          ],
          transitions: [
            { from: "a", to: "b", action: "go", allowed_roles: [], side_effects: { set: { frozen_note: "x", delivered_at: "2026-01-01T00:00:00Z" } } },
          ],
        },
      ),
    );
    const warnedFields = warn.mock.calls.map((c) => (c[0] as { field?: string })?.field);
    expect(warnedFields).toContain("frozen_note");
    expect(warnedFields).not.toContain("delivered_at"); // band field — no advisory
  });
});
