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

  it("keeps owner filterable where no row names fields, for a role that reads only its own rows above level 0", () => {
    const checker = checkerFor([{ role: "Clerk", level: 0, select: 1 }, { role: "Clerk", level: 1, read: 1, if_owner: true }]);
    expect(checker.getReadableFields(clerk, "Item", { _id: "I-1", owner: "other@test" })!.has("owner")).toBe(true);
    expect(checker.getReadableFields(clerk, "Item", { _id: "I-2", owner: "c@test" })!.has("owner")).toBe(true);
    expect(checker.getFilterAllowlist(clerk, "Item").has("owner")).toBe(true);
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
});
