import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import { resolveDefaults } from "../src/core/defaults/default-resolver.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntity(overrides: Partial<EntityDefinition> = {}): EntityDefinition {
  return {
    name: "TestDoc",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [],
    permissions: [],
    ...overrides,
  };
}

// Fixed date for time-sensitive assertions
const FIXED_DATE = new Date("2026-04-12T09:30:00.000Z");
const FIXED_DATE_ISO = "2026-04-12";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveDefaults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expands magic-token + user defaults inside child-table rows (H-P5)", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [
            { fieldname: "product", fieldtype: "Data", label: "Product" },
            { fieldname: "line_date", fieldtype: "Date", label: "Date", default: "__today__" },
            { fieldname: "added_by", fieldtype: "Data", label: "By", default: "__user__" },
          ],
        },
      ],
    } as unknown as EntityDefinition);
    const result = resolveDefaults(
      entity,
      { lines: [{ product: "P-1" }, { product: "P-2", line_date: "2026-01-01" }] },
      "op@x.io",
    );
    const rows = result["lines"] as Array<Record<string, unknown>>;
    // Unset row fields get the EXPANDED default (not the literal "__today__").
    expect(rows[0]!["line_date"]).toBe(FIXED_DATE_ISO);
    expect(rows[0]!["added_by"]).toBe("op@x.io");
    // An already-set row value is preserved; other unset defaults still apply.
    expect(rows[1]!["line_date"]).toBe("2026-01-01");
    expect(rows[1]!["added_by"]).toBe("op@x.io");
  });

  // ── No fields / no defaults ───────────────────────────────────────────────

  it("returns a shallow copy of data unchanged when entity has no fields", () => {
    const entity = makeEntity({ fields: [] });
    const data = { title: "Hello" };
    const result = resolveDefaults(entity, data, "admin@example.com");
    expect(result).toEqual({ title: "Hello" });
    expect(result).not.toBe(data); // must be a new object
  });

  it("does not mutate the original data object", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" }],
    });
    const data: Record<string, unknown> = {};
    resolveDefaults(entity, data, "admin@example.com");
    expect("status" in data).toBe(false);
  });

  // ── No default defined ────────────────────────────────────────────────────

  it("skips fields that have no default property", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("title" in result).toBe(false);
  });

  // ── Static defaults ───────────────────────────────────────────────────────

  it("applies static string default to empty field", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.status).toBe("Draft");
  });

  it("applies static numeric default to empty field", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "priority", fieldtype: "Int", label: "Priority", default: 5 },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.priority).toBe(5);
  });

  it("applies static boolean default (Check field)", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "is_active", fieldtype: "Check", label: "Is Active", default: 1 },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.is_active).toBe(1);
  });

  it("applies static zero default (Check field off)", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "is_draft", fieldtype: "Check", label: "Is Draft", default: 0 },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.is_draft).toBe(0);
  });

  // ── Does not override existing values ─────────────────────────────────────

  it("does not override a field that already has a non-empty string value", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(entity, { status: "Active" }, "admin@example.com");
    expect(result.status).toBe("Active");
  });

  it("does not override a field with a numeric value (including 0)", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "count", fieldtype: "Int", label: "Count", default: 10 },
      ],
    });
    // 0 is falsy but not undefined/null/"" — the impl only skips if !==undefined/null/""
    // 0 !== undefined and 0 !== null and 0 !== "" → should NOT be overridden
    const result = resolveDefaults(entity, { count: 0 }, "admin@example.com");
    expect(result.count).toBe(0);
  });

  it("applies default when field value is undefined", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(entity, { status: undefined }, "admin@example.com");
    expect(result.status).toBe("Draft");
  });

  it("applies default when field value is null", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(entity, { status: null }, "admin@example.com");
    expect(result.status).toBe("Draft");
  });

  it("applies default when field value is empty string", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(entity, { status: "" }, "admin@example.com");
    expect(result.status).toBe("Draft");
  });

  // ── Layout fields skipped ─────────────────────────────────────────────────

  it("skips SectionBreak fields even when they have a default", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "sec", fieldtype: "SectionBreak", label: "Section", default: "something" },
        { fieldname: "title", fieldtype: "Data", label: "Title", default: "Hello" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("sec" in result).toBe(false);
    expect(result.title).toBe("Hello");
  });

  it("skips ColumnBreak fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "col", fieldtype: "ColumnBreak", label: "Col", default: "x" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("col" in result).toBe(false);
  });

  it("skips TabBreak fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "tab1", fieldtype: "TabBreak", label: "Tab", default: "y" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("tab1" in result).toBe(false);
  });

  it("skips Heading fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "hdr", fieldtype: "Heading", label: "Header", default: "title" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("hdr" in result).toBe(false);
  });

  it("skips HTML and Button fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "html1", fieldtype: "HTML", label: "HTML", default: "<p></p>" },
        { fieldname: "btn1", fieldtype: "Button", label: "Button", default: "click" },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount", default: 0 },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect("html1" in result).toBe(false);
    expect("btn1" in result).toBe(false);
    // amount default is 0 (non-string) — it still gets applied
    expect(result.amount).toBe(0);
  });

  // ── Magic token: __today__ ────────────────────────────────────────────────

  it("resolves __today__ to current date as YYYY-MM-DD string", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "date", fieldtype: "Date", label: "Date", default: "__today__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.date).toBe(FIXED_DATE_ISO);
  });

  it("__today__ format is always YYYY-MM-DD (10 chars)", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "posting_date", fieldtype: "Date", label: "Date", default: "__today__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "user@example.com");
    expect(typeof result.posting_date).toBe("string");
    expect((result.posting_date as string).length).toBe(10);
    expect((result.posting_date as string)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // ── Magic token: __now__ ──────────────────────────────────────────────────

  it("resolves __now__ to a Date object", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "created_at", fieldtype: "Datetime", label: "Created At", default: "__now__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.created_at).toBeInstanceOf(Date);
  });

  it("resolves __now__ to the current system time", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "ts", fieldtype: "Datetime", label: "Timestamp", default: "__now__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect((result.ts as Date).toISOString()).toBe(FIXED_DATE.toISOString());
  });

  // ── Magic token: __user__ ─────────────────────────────────────────────────

  it("resolves __user__ to the user parameter (email/id)", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "owner", fieldtype: "Data", label: "Owner", default: "__user__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "jane@example.com");
    expect(result.owner).toBe("jane@example.com");
  });

  it("resolves __user__ to the exact user string passed in", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "assigned_to", fieldtype: "Link", label: "Assigned To", default: "__user__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "user-id-123");
    expect(result.assigned_to).toBe("user-id-123");
  });

  // ── Magic token: __username__ ─────────────────────────────────────────────

  it("resolves __username__ to the userName param when provided", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "full_name", fieldtype: "Data", label: "Full Name", default: "__username__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com", "Alice Smith");
    expect(result.full_name).toBe("Alice Smith");
  });

  it("resolves __username__ to user param when userName is not provided", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "username", fieldtype: "Data", label: "Username", default: "__username__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.username).toBe("admin@example.com");
  });

  it("resolves __username__ to user param when userName is undefined", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "username", fieldtype: "Data", label: "Username", default: "__username__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com", undefined);
    expect(result.username).toBe("admin@example.com");
  });

  // ── Unknown token treated as static ──────────────────────────────────────

  it("treats unknown magic-like token as a static string value", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "code", fieldtype: "Data", label: "Code", default: "__unknown_token__" },
      ],
    });
    const result = resolveDefaults(entity, {}, "admin@example.com");
    expect(result.code).toBe("__unknown_token__");
  });

  // ── Multiple fields ───────────────────────────────────────────────────────

  it("applies defaults to multiple fields independently", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
        { fieldname: "date", fieldtype: "Date", label: "Date", default: "__today__" },
        { fieldname: "owner", fieldtype: "Data", label: "Owner", default: "__user__" },
        { fieldname: "priority", fieldtype: "Int", label: "Priority", default: 3 },
      ],
    });
    const result = resolveDefaults(entity, {}, "bob@example.com", "Bob");
    expect(result.status).toBe("Draft");
    expect(result.date).toBe(FIXED_DATE_ISO);
    expect(result.owner).toBe("bob@example.com");
    expect(result.priority).toBe(3);
  });

  it("only applies defaults to fields that are unset, leaves others alone", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
        { fieldname: "title", fieldtype: "Data", label: "Title", default: "Untitled" },
      ],
    });
    const result = resolveDefaults(entity, { status: "Submitted" }, "admin@example.com");
    expect(result.status).toBe("Submitted"); // existing value preserved
    expect(result.title).toBe("Untitled");    // missing field gets default
  });

  it("preserves extra data fields that are not in entity fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "status", fieldtype: "Select", label: "Status", default: "Draft" },
      ],
    });
    const result = resolveDefaults(
      entity,
      { status: "Active", extra_field: "preserved", another: 42 },
      "admin@example.com",
    );
    expect(result.extra_field).toBe("preserved");
    expect(result.another).toBe(42);
    expect(result.status).toBe("Active");
  });
});

describe("resolveDefaults — eval: expression defaults", () => {
  it("evaluates an eval: default against the doc-in-progress", () => {
    const e = makeEntity({
      fields: [
        { fieldname: "qty", fieldtype: "Int", label: "Qty" },
        { fieldname: "rate", fieldtype: "Currency", label: "Rate" },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount", default: "eval:doc.qty * doc.rate" },
      ],
    } as Partial<EntityDefinition>);
    const result = resolveDefaults(e, { qty: 3, rate: 10 }, "admin@test.local");
    expect(result.amount).toBe(30);
  });

  it("does not override an already-set value", () => {
    const e = makeEntity({
      fields: [
        { fieldname: "qty", fieldtype: "Int", label: "Qty" },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount", default: "eval:doc.qty * 2" },
      ],
    } as Partial<EntityDefinition>);
    const result = resolveDefaults(e, { qty: 5, amount: 99 }, "admin@test.local");
    expect(result.amount).toBe(99); // user-set value wins over the default
  });

  it("safe-defaults to null on an invalid expression", () => {
    const e = makeEntity({
      fields: [{ fieldname: "x", fieldtype: "Data", label: "X", default: "eval:!@#$%" }],
    } as Partial<EntityDefinition>);
    const result = resolveDefaults(e, {}, "admin@test.local");
    expect(result.x).toBeNull();
  });
});
