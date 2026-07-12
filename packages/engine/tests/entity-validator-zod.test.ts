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
import { validateEntityDataZod } from "../src/core/entity/entity-validator-zod.js";
import { ZodSchemaBuilder } from "../src/core/entity/zod-schema-builder.js";

function entity(fields: Record<string, unknown>[]): EntityDefinition {
  return {
    name: "TestDoc",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields,
    permissions: [],
  } as unknown as EntityDefinition;
}

const builder = new ZodSchemaBuilder();

/**
 * Schema-migration / backward-compat safety. Reads intentionally do NOT re-validate
 * (deserialize is pure coercion, for performance) — so the safety net is at WRITE
 * time: a document shaped under an OLD schema must be REJECTED when it violates the
 * NEW schema's constraints, never silently persisted. These cover the breaking
 * changes a post-go-live migration can introduce.
 */
describe("validateEntityDataZod — schema migration (write-time safety)", () => {
  it("required-flip: a doc missing a newly-required field is rejected on write", () => {
    // v2 makes `region` required; a v1 doc never set it.
    const v2 = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
      { fieldname: "region", fieldtype: "Data", label: "Region", required: true },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(v2, { name: "ok" }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "region")).toBe(true);
  });

  it("retype: incompatible old data for a retyped field is rejected on write", () => {
    // v1 stored `amount` as free text; v2 retypes it to Int.
    const v2 = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
      { fieldname: "amount", fieldtype: "Int", label: "Amount" },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(v2, { name: "ok", amount: "not-a-number" }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "amount")).toBe(true);
  });

  it("retype: coercible old data passes (numeric string → Int)", () => {
    const v2 = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
      { fieldname: "amount", fieldtype: "Int", label: "Amount" },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(v2, { name: "ok", amount: "42" }, builder).valid).toBe(true);
  });

  it("field-removal is lenient: stale data for a dropped field is preserved, not rejected", () => {
    // v2 dropped `legacy_code`; an old doc still carries it. passthrough() keeps the
    // value (no data loss) and validation does not reject — documents read leniency.
    const v2 = entity([{ fieldname: "name", fieldtype: "Data", label: "Name", required: true }]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(v2, { name: "ok", legacy_code: "X-1" }, builder);
    expect(r.valid).toBe(true);
  });
});

describe("validateEntityDataZod — Attach URL scheme safety (audit 465)", () => {
  const withAttach = () => entity([{ fieldname: "doc_url", fieldtype: "Attach", label: "Doc" }]);

  it("rejects a javascript: URL stored in an Attach field", () => {
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(withAttach(), { doc_url: "javascript:alert(1)" }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "doc_url")).toBe(true);
  });

  it("accepts http(s), relative storage keys, and inline data:image", () => {
    for (const v of [
      "https://cdn/x.pdf",
      "erp/customers/f.pdf",
      "/uploads/a.png",
      "data:image/png;base64,AAAA",
    ]) {
      builder.invalidate("TestDoc");
      const r = validateEntityDataZod(withAttach(), { doc_url: v }, builder);
      expect(r.valid, `expected ${v} to be valid`).toBe(true);
    }
  });
});

describe("validateEntityDataZod — Table per-row mandatory_depends_on", () => {
  const withCondTable = () =>
    entity([
      {
        fieldname: "items",
        fieldtype: "Table",
        label: "Items",
        child_fields: [
          { fieldname: "type", fieldtype: "Select", label: "Type", options: ["debit", "credit"] },
          {
            fieldname: "account",
            fieldtype: "Data",
            label: "Account",
            mandatory_depends_on: "eval:doc.type=='debit'",
          },
        ],
      },
    ]);

  it("rejects an empty cell when its mandatory_depends_on condition is true", () => {
    const e = withCondTable();
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { items: [{ type: "debit", account: "" }] }, builder);
    expect(r.valid).toBe(false);
    expect(
      r.errors.some(
        (err) => err.field === "items[0].account" && err.message_key === "field_mandatory_depends_on",
      ),
    ).toBe(true);
  });

  it("allows an empty cell when its mandatory_depends_on condition is false", () => {
    const e = withCondTable();
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { items: [{ type: "credit", account: "" }] }, builder);
    expect(r.valid).toBe(true);
  });

  it("accepts a filled cell when its mandatory_depends_on condition is true", () => {
    const e = withCondTable();
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { items: [{ type: "debit", account: "1000" }] }, builder);
    expect(r.valid).toBe(true);
  });

  it("validates rows independently (flags only the offending row)", () => {
    const e = withCondTable();
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(
      e,
      {
        items: [
          { type: "debit", account: "1000" }, // ok
          { type: "credit", account: "" }, // ok (condition false)
          { type: "debit", account: "" }, // invalid
        ],
      },
      builder,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.filter((err) => err.field === "items[2].account").length).toBe(1);
    expect(r.errors.filter((err) => err.field === "items[0].account").length).toBe(0);
  });
});

describe("validateEntityDataZod — required + types", () => {
  it("rejects missing required field", () => {
    const e = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, {}, builder);
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.field).toBe("name");
  });

  it("accepts a valid required field", () => {
    const e = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { name: "ok" }, builder);
    expect(r.valid).toBe(true);
  });

  it("optional field may be missing", () => {
    const e = entity([
      { fieldname: "note", fieldtype: "Data", label: "Note" },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, {}, builder).valid).toBe(true);
  });
});

describe("validateEntityDataZod — string constraints", () => {
  it("enforces max_length", () => {
    const e = entity([
      { fieldname: "code", fieldtype: "Data", label: "Code", max_length: 3 },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { code: "TOO_LONG" }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.field).toBe("code");
  });

  it("enforces regex", () => {
    const e = entity([
      { fieldname: "sku", fieldtype: "Data", label: "SKU", regex: "^[A-Z]{3}-\\d+$" },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { sku: "ABC-1" }, builder).valid).toBe(true);
    expect(validateEntityDataZod(e, { sku: "abc1" }, builder).valid).toBe(false);
  });

  it("Email format via Data.options", () => {
    const e = entity([
      { fieldname: "email", fieldtype: "Data", label: "Email", options: "Email", required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { email: "ada@x.com" }, builder).valid).toBe(true);
    expect(validateEntityDataZod(e, { email: "no-at-sign" }, builder).valid).toBe(false);
  });
});

describe("validateEntityDataZod — number constraints", () => {
  it("Int rejects non-integer", () => {
    const e = entity([
      { fieldname: "count", fieldtype: "Int", label: "Count", required: true },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { count: 3.5 }, builder);
    expect(r.valid).toBe(false);
  });

  it("min_value / max_value", () => {
    const e = entity([
      { fieldname: "qty", fieldtype: "Int", label: "Qty", min_value: 1, max_value: 10, required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { qty: 5 }, builder).valid).toBe(true);
    expect(validateEntityDataZod(e, { qty: 0 }, builder).valid).toBe(false);
    expect(validateEntityDataZod(e, { qty: 11 }, builder).valid).toBe(false);
  });

  it("non_negative", () => {
    const e = entity([
      { fieldname: "amt", fieldtype: "Float", label: "Amt", non_negative: true, required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amt: 5.5 }, builder).valid).toBe(true);
    expect(validateEntityDataZod(e, { amt: -1 }, builder).valid).toBe(false);
  });
});

describe("validateEntityDataZod — Select", () => {
  it("Select with options enforces enum", () => {
    const e = entity([
      { fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "submitted"], required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { status: "draft" }, builder).valid).toBe(true);
    expect(validateEntityDataZod(e, { status: "bogus" }, builder).valid).toBe(false);
  });
});

describe("validateEntityDataZod — Table rows", () => {
  it("min_rows rejects fewer", () => {
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        min_rows: 1,
        child_fields: [{ fieldname: "x", fieldtype: "Data", label: "X" }],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { lines: [] }, builder);
    expect(r.valid).toBe(false);
  });

  it("validates each row's fields", () => {
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "qty", fieldtype: "Int", label: "Qty", required: true, min_value: 1 },
        ],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { lines: [{ qty: 0 }] }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.field).toBe("lines[0].qty");
  });

  it("preserves row-uniqueness check (calls validateRowUniqueness)", () => {
    const e = entity([
      {
        fieldname: "addresses",
        fieldtype: "Table",
        label: "Addr",
        row_unique: [["purpose"]],
        child_fields: [
          { fieldname: "purpose", fieldtype: "Select", label: "Purpose", options: ["billing", "shipping"] },
        ],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, {
      addresses: [{ purpose: "billing" }, { purpose: "billing" }],
    }, builder);
    expect(r.valid).toBe(false);
    const dup = r.errors.find((er) => er.message_key === "table_row_unique_violation");
    expect(dup).toBeDefined();
  });
});

describe("validateEntityDataZod — Geolocation", () => {
  it("accepts valid Point", () => {
    const e = entity([
      { fieldname: "loc", fieldtype: "Geolocation", label: "Loc", required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(
      validateEntityDataZod(e, { loc: { type: "Point", coordinates: [13.4, 52.5] } }, builder).valid,
    ).toBe(true);
  });

  it("rejects invalid coordinates", () => {
    const e = entity([
      { fieldname: "loc", fieldtype: "Geolocation", label: "Loc", required: true },
    ]);
    builder.invalidate("TestDoc");
    expect(
      validateEntityDataZod(e, { loc: { type: "Point", coordinates: [200, 0] } }, builder).valid,
    ).toBe(false);
  });
});

describe("validateEntityDataZod — passthrough on engine fields", () => {
  it("does not reject system-stamped fields", () => {
    const e = entity([
      { fieldname: "name", fieldtype: "Data", label: "Name", required: true },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, {
      name: "ok",
      _id: "DOC-1",
      docstatus: 0,
      owner: "admin",
      creation: new Date(),
      modified: new Date(),
    }, builder);
    expect(r.valid).toBe(true);
  });
});

describe("validateEntityDataZod — Color (isValidColor wiring)", () => {
  const colorEntity = entity([{ fieldname: "shade", fieldtype: "Color", label: "Shade" }]);

  it("accepts #rgb / #rrggbb / #rrggbbaa", () => {
    for (const ok of ["#fff", "#1a2b3c", "#deadbeef"]) {
      builder.invalidate("TestDoc");
      expect(validateEntityDataZod(colorEntity, { shade: ok }, builder).valid).toBe(true);
    }
  });

  it("rejects non-hex / malformed colors", () => {
    for (const bad of ["red", "#gg0011", "#ff", "123456"]) {
      builder.invalidate("TestDoc");
      expect(validateEntityDataZod(colorEntity, { shade: bad }, builder).valid).toBe(false);
    }
  });
});

describe("validateEntityDataZod — Time field (wall-clock HH:mm, not a Date)", () => {
  const timeEntity = entity([{ fieldname: "at", fieldtype: "Time", label: "At" }]);

  it("accepts canonical HH:mm and HH:mm:ss values (happy path)", () => {
    for (const good of ["14:30", "00:00", "23:59", "09:15:30", ""]) {
      builder.invalidate("TestDoc");
      expect(validateEntityDataZod(timeEntity, { at: good }, builder).valid).toBe(true);
    }
  });

  it("rejects out-of-range / malformed times", () => {
    for (const bad of ["25:00", "14:60", "1430", "14:3", "noon"]) {
      builder.invalidate("TestDoc");
      expect(validateEntityDataZod(timeEntity, { at: bad }, builder).valid).toBe(false);
    }
  });
});

describe("validateEntityDataZod — numeric empty-guard (A10)", () => {
  it("rejects an empty-string value for a numeric field (was silently coerced to 0)", () => {
    const e = entity([{ fieldname: "amount", fieldtype: "Currency", label: "Amount", required: true }]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amount: "" }, builder).valid).toBe(false);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amount: "  " }, builder).valid).toBe(false);
  });
  it("still accepts a genuine number / numeric string", () => {
    const e = entity([{ fieldname: "amount", fieldtype: "Currency", label: "Amount", required: true }]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amount: 42 }, builder).valid).toBe(true);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amount: "42" }, builder).valid).toBe(true);
  });
});

describe("validateEntityDataZod — Duration is whole non-negative seconds (A6)", () => {
  it("rejects a decimal Duration (no silent truncation)", () => {
    const e = entity([{ fieldname: "dur", fieldtype: "Duration", label: "Dur" }]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { dur: 1.5 }, builder).valid).toBe(false);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { dur: -5 }, builder).valid).toBe(false);
  });
  it("accepts a whole-second Duration", () => {
    const e = entity([{ fieldname: "dur", fieldtype: "Duration", label: "Dur" }]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { dur: 90 }, builder).valid).toBe(true);
  });
});

describe("validateEntityDataZod — top-level conditional-required (A11)", () => {
  const e = () =>
    entity([
      { fieldname: "type", fieldtype: "Data", label: "Type" },
      { fieldname: "reason", fieldtype: "Data", label: "Reason", mandatory_depends_on: "eval:doc.type=='debit'" },
    ]);
  it("rejects an empty conditionally-required field when its condition holds", () => {
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e(), { type: "debit", reason: "" }, builder);
    expect(r.valid).toBe(false);
    expect(r.errors.some((x) => x.field === "reason" && x.message_key === "field_mandatory_depends_on")).toBe(true);
  });
  it("accepts it when filled, or when the condition is false", () => {
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e(), { type: "debit", reason: "x" }, builder).valid).toBe(true);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e(), { type: "credit", reason: "" }, builder).valid).toBe(true);
  });
});
