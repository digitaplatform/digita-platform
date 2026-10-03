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

// A row with `fields` opens the named fields of its level only. Rows add up on a record: what any
// row that admits it opens is open there. A list filters, sorts and searches only on what it reads
// on every row it answers.
function checkerFor(permissions: unknown[]): PermissionChecker {
  const registry = new EntityRegistry();
  registry.register({
    name: "Item",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      { fieldname: "title", fieldtype: "Data", label: "Title" },
      { fieldname: "cost", fieldtype: "Currency", label: "Cost" },
      { fieldname: "margin", fieldtype: "Percent", label: "Margin", perm_level: 1 },
      { fieldname: "audit_note", fieldtype: "Data", label: "Audit Note", perm_level: 1 },
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "qty", fieldtype: "Float", label: "Qty" },
          { fieldname: "line_cost", fieldtype: "Currency", label: "Line Cost", perm_level: 1 },
        ],
      },
    ],
    permissions: permissions as EntityDefinition["permissions"],
  } as unknown as EntityDefinition);
  return new PermissionChecker(registry);
}

const clerk: UserContext = { _id: "c", email: "c@test", roles: ["Clerk"] };
const sorted = (set: Set<string> | null) => (set ? [...set].sort() : set);

describe("PermissionChecker — fields on a permission row", () => {
  it("opens the named fields of the row's level and the identity fields, not owner", () => {
    const checker = checkerFor([{ role: "Clerk", level: 0, select: 1, read: 1, fields: ["title", "margin"] }]);
    expect(sorted(checker.getReadableFields(clerk, "Item"))).toEqual(["_id", "creation", "docstatus", "doctype", "modified", "title"]);
    expect(checker.getFilterAllowlist(clerk, "Item").has("owner")).toBe(false);
    expect(checker.getFilterAllowlist(clerk, "Item").has("cost")).toBe(false);
  });

  it("adds up with a row without fields, which opens its whole level and owner", () => {
    const checker = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, fields: ["title"] },
      { role: "Clerk", level: 1, read: 1 },
    ]);
    const readable = checker.getReadableFields(clerk, "Item")!;
    expect(readable.has("margin") && readable.has("audit_note") && readable.has("owner")).toBe(true);
    expect(readable.has("cost")).toBe(false);
    expect(checker.getFilterAllowlist(clerk, "Item").has("owner")).toBe(true);
  });

  it("opens a child of the row's level only when the row names its Table", () => {
    const naming = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, fields: ["lines"] },
      { role: "Clerk", level: 1, read: 1, fields: ["lines", "margin"] },
    ]);
    expect(sorted(naming.getReadableChildFields(clerk, "Item", "lines"))).toEqual(["_row_id", "idx", "line_cost", "qty"]);
    expect(naming.getFilterableFields(clerk, "Item")).toEqual(new Set(["lines", "margin"]));
    const silent = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, fields: ["lines"] },
      { role: "Clerk", level: 1, read: 1, fields: ["margin"] },
    ]);
    expect(sorted(silent.getReadableChildFields(clerk, "Item", "lines"))).toEqual(["_row_id", "idx", "qty"]);
    expect(silent.getFilterableFields(clerk, "Item")).toEqual(new Set(["lines.qty", "margin"]));
  });

  it("shows a level-0 link title only when a row that selects names it", async () => {
    const hidden = checkerFor([{ role: "Clerk", level: 0, select: 1, read: 1, fields: ["cost"] }]);
    expect(await hidden.isTitleVisible(clerk, "Item", { _id: "I-1", title: "Bolt" }, "title")).toBe(false);
    const shown = checkerFor([{ role: "Clerk", level: 0, select: 1, read: 1, fields: ["title"] }]);
    expect(await shown.isTitleVisible(clerk, "Item", { _id: "I-1", title: "Bolt" }, "title")).toBe(true);
  });

  // A released item shows its title and cost, a draft only its cost.
  const gated = () =>
    checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, condition: "eval:doc.status=='released'", fields: ["title", "cost"] },
      { role: "Clerk", level: 0, select: 1, read: 1, condition: "eval:doc.status=='draft'", fields: ["cost"] },
    ]);

  it("shows a link title only where a row that admits the record names it", async () => {
    const checker = gated();
    const draft = { _id: "I-2", title: "Secret", status: "draft" };
    expect(checker.getReadableFields(clerk, "Item", draft)!.has("title")).toBe(false);
    expect(await checker.isTitleVisible(clerk, "Item", draft, "title")).toBe(false);
    expect(await checker.isTitleVisible(clerk, "Item", { _id: "I-1", title: "Bolt", status: "released" }, "title")).toBe(true);
  });

  it("lets a list filter and a picker show only what every gated level-0 row opens", () => {
    const checker = gated();
    expect(checker.getFilterableFields(clerk, "Item")).toEqual(new Set(["cost"]));
    expect(checker.isPickerTitleVisible(clerk, "Item", "title")).toBe(false);
  });

  it("refuses operator filters where only a gated higher-level read opens operator fields", () => {
    const checker = checkerFor([{ role: "Clerk", level: 0, select: 1 }, { role: "Clerk", level: 1, read: 1, if_owner: true }]);
    expect(checker.getReadableFields(clerk, "Item", { _id: "I-1", owner: "other@test" })!.has("owner")).toBe(false);
    expect(checker.getReadableFields(clerk, "Item", { _id: "I-2", owner: "c@test" })!.has("owner")).toBe(true);
    const allowed = checker.getFilterAllowlist(clerk, "Item");
    expect([allowed.has("owner"), allowed.has("modified_by")]).toEqual([false, false]);
  });

  it("filters every level-0 field and owner through two gated level-0 rows without fields", () => {
    const checker = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, if_owner: true },
      { role: "Clerk", level: 0, select: 1, read: 1, condition: "eval:doc.title=='x'" },
    ]);
    const allowed = checker.getFilterAllowlist(clerk, "Item");
    expect([allowed.has("title"), allowed.has("owner"), allowed.has("margin")]).toEqual([true, true, false]);
  });

  it("lets a row that holds on every row open its fields to a list, and no gated row add to them", () => {
    const checker = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, fields: ["title"] },
      { role: "Clerk", level: 0, select: 1, read: 1, condition: "eval:doc.status=='released'", fields: ["title", "cost"] },
    ]);
    expect(checker.getFilterableFields(clerk, "Item")).toEqual(new Set(["title"]));
    expect(checker.isPickerTitleVisible(clerk, "Item", "title")).toBe(true);
  });

  it("PLANTED DEFECT: reads no owner or modified_by on every row when each read row of the user is gated", () => {
    const checker = checkerFor([
      { role: "Clerk", level: 0, select: 1, read: 1, if_owner: true },
      { role: "Clerk", level: 0, select: 1, read: 1, condition: "eval:doc.title=='x'" },
    ]);
    const everyRow = checker.getReadableFieldsOnEveryRow(clerk, "Item");
    expect([everyRow?.has("owner"), everyRow?.has("modified_by"), everyRow?.has("title")]).toEqual([false, false, false]);
  });

  it("PLANTED INNOCENT: reads owner and modified_by on every row through an ungated row that opens every field", () => {
    const everyRow = checkerFor([{ role: "Clerk", level: 0, select: 1, read: 1 }]).getReadableFieldsOnEveryRow(clerk, "Item");
    expect([everyRow?.has("owner"), everyRow?.has("modified_by"), everyRow?.has("title")]).toEqual([true, true, true]);
  });
});


describe("PermissionChecker — readable tree defaults", () => {
  function treeChecker(permissions: EntityDefinition["permissions"], defaultActive = 1) {
    const registry = new EntityRegistry();
    const entity = {
      name: "Group", module: "test", database: "app", tree: {},
      naming: { strategy: "user_set" },
      fields: [
        { fieldname: "active", fieldtype: "Check", label: "Active", default: defaultActive },
        { fieldname: "lines", fieldtype: "Table", label: "Lines", child_fields: [
          { fieldname: "qty", fieldtype: "Int", label: "Quantity" },
          { fieldname: "cost_price", fieldtype: "Currency", label: "Cost price", perm_level: 2 },
        ] },
      ],
      permissions,
    } as EntityDefinition;
    registry.prepareDefinition(entity);
    registry.register(entity);
    return new PermissionChecker(registry);
  }

  it("returns known root/active defaults without changing the stored row", () => {
    const checker = treeChecker([{ role: "Clerk", level: 0, read: 1, select: 1 }]);
    const stored = { _id: "G-1", label: "Root" };
    expect(checker.filterFieldsForRead(clerk, "Group", stored)).toMatchObject({ parent: null, active: true });
    expect(stored).toEqual({ _id: "G-1", label: "Root" });
    expect(checker.filterFieldsForRead({ ...clerk, roles: [SYSTEM_ROLES.ADMINISTRATOR] }, "Group", stored))
      .toMatchObject({ parent: null, active: true });
    expect(treeChecker([{ role: "Clerk", level: 0, read: 1 }], 0).filterFieldsForRead(clerk, "Group", stored).active)
      .toBe(false);
    expect(checker.filterFieldsForRead(clerk, "Group", { ...stored, active: false }).active).toBe(false);
  });

  it.each([
    [["label", "active"], "parent"],
    [["label", "parent"], "active"],
  ])("keeps the unreadable %s eligibility field absent", (fields, masked) => {
    const checker = treeChecker([{ role: "Clerk", level: 0, read: 1, select: 1, fields: fields as string[] }]);
    expect(checker.filterFieldsForRead(clerk, "Group", { _id: "G-1", label: "Root" }))
      .not.toHaveProperty(masked as string);
  });

  it("never lets a display default satisfy a Table child permission condition", () => {
    const checker = treeChecker([
      { role: "Clerk", level: 0, read: 1, select: 1 },
      { role: "Clerk", level: 2, read: 1, condition: "eval:doc.active==true", fields: ["lines"] },
    ]);
    const stored = { _id: "G-1", label: "Root", lines: [{ qty: 1, cost_price: 99 }] };
    expect(checker.filterFieldsForRead(clerk, "Group", stored)).toMatchObject({ active: true, lines: [{ qty: 1 }] });
    expect((checker.filterFieldsForRead(clerk, "Group", stored).lines as Record<string, unknown>[])[0])
      .not.toHaveProperty("cost_price");
    expect(checker.filterFieldsForRead(clerk, "Group", { ...stored, active: true }).lines)
      .toEqual([{ qty: 1, cost_price: 99 }]);
  });

  it("decides conditional field visibility against the stored row", () => {
    const checker = treeChecker([
      { role: "Clerk", level: 0, read: 1, select: 1, fields: ["label"] },
      { role: "Clerk", level: 0, read: 1, condition: "eval:doc.active==true", fields: ["parent", "active"] },
    ]);
    const defaults = checker.filterFieldsForRead(clerk, "Group", { _id: "G-1", label: "Root" });
    expect(defaults).not.toHaveProperty("parent");
    expect(defaults).not.toHaveProperty("active");
    expect(checker.filterFieldsForRead(clerk, "Group", { _id: "G-2", label: "Root", active: true }))
      .toMatchObject({ parent: null, active: true });
  });
});
