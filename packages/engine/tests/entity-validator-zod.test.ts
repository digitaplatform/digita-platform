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
import { getFieldTypeHandler } from "../src/core/entity/field-types.js";

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
  // A required field's blank value is refused by the blank check before the guard, so the blank
  // string the guard refuses is an optional field's.
  it("refuses a blank string, a boolean and an array in a numeric field, required or not", () => {
    for (const required of [false, true]) {
      const e = entity([{ fieldname: "amount", fieldtype: "Currency", label: "Amount", required }]);
      for (const bad of required ? [true, false, [], [5]] : ["", "  ", true, false, [], [5]]) {
        builder.invalidate("TestDoc");
        expect(validateEntityDataZod(e, { amount: bad }, builder).valid).toBe(false);
      }
    }
  });
  it("lets an optional numeric field be null or missing", () => {
    const e = entity([{ fieldname: "amount", fieldtype: "Currency", label: "Amount" }]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { amount: null }, builder).valid).toBe(true);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, {}, builder).valid).toBe(true);
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

describe("validateEntityDataZod — a blank value is no value", () => {
  // Each value goes through its type's handler and then the validator, the order
  // DocumentService.insert and update use. Check and Rating are left out: their
  // handlers store a missing value as false and 0.
  const blankableTypes = [
    "Data", "Phone", "Barcode", "Signature", "Password", "Time", "Attach", "AttachImage", "Image",
    "Text", "SmallText", "TextEditor", "Code", "Markdown", "Select", "Link", "Color",
    "Int", "Float", "Currency", "Percent", "Duration", "Date", "Datetime", "JSON", "Tag",
    "Geolocation", "ReadOnly",
  ];
  const validateStored = (field: Record<string, unknown>, value: unknown) => {
    const stored = getFieldTypeHandler(field.fieldtype as never).toStorage(value, field as never);
    builder.invalidate("TestDoc");
    return validateEntityDataZod(entity([field]), { [field.fieldname as string]: stored }, builder);
  };

  for (const fieldtype of blankableTypes) {
    for (const value of ["", "   "]) {
      it(`a required ${fieldtype} field refuses ${JSON.stringify(value)} with field_required`, () => {
        const r = validateStored({ fieldname: "f", fieldtype, label: "F", required: true }, value);
        expect(r.errors.map((e) => [e.field, e.message_key])).toEqual([["f", "field_required"]]);
      });
    }
  }

  // Tag is left out: its handler stores "" as it is, and a Tag holds a list.
  for (const fieldtype of blankableTypes.filter((t) => t !== "Tag")) {
    it(`an optional ${fieldtype} field accepts ""`, () => {
      expect(validateStored({ fieldname: "f", fieldtype, label: "F" }, "").errors).toEqual([]);
    });
  }

  it("an optional text field with a format rule accepts a blank value", () => {
    for (const rule of [{ options: "Email" }, { options: "URL" }, { regex: "^[A-Z]{3}$" }, { min_length: 3 }]) {
      expect(validateStored({ fieldname: "f", fieldtype: "Data", label: "F", ...rule }, "   ").errors).toEqual([]);
    }
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [{ fieldname: "email", fieldtype: "Data", label: "Email", options: "Email" }],
      },
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { lines: [{ email: "   " }] }, builder).errors).toEqual([]);
  });

  // Date and Datetime are no string schema, so the blank preprocess of an optional text field does
  // not reach them: their own rule accepts the blank string.
  it("an optional Date or Datetime cell of a Table row accepts a blank string", () => {
    for (const fieldtype of ["Date", "Datetime"]) {
      const e = entity([
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [{ fieldname: "on", fieldtype, label: "On" }],
        },
      ]);
      builder.invalidate("TestDoc");
      expect(validateEntityDataZod(e, { lines: [{ on: "" }] }, builder).errors).toEqual([]);
    }
  });

  it("a required Data or Time field with a value passes", () => {
    expect(validateStored({ fieldname: "f", fieldtype: "Data", label: "F", required: true }, "x").valid).toBe(true);
    expect(validateStored({ fieldname: "f", fieldtype: "Time", label: "F", required: true }, "09:30").valid).toBe(true);
  });

  it("a required cell of a Table row refuses a whitespace-only value", () => {
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [{ fieldname: "sku", fieldtype: "Data", label: "SKU", required: true }],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { lines: [{ sku: "A-1" }, { sku: "   " }] }, builder);
    expect(r.errors.map((x) => [x.field, x.message_key])).toEqual([["lines[1].sku", "field_required"]]);
  });

  it("a field whose mandatory_depends_on holds refuses a whitespace-only value", () => {
    const e = entity([
      { fieldname: "type", fieldtype: "Data", label: "Type" },
      { fieldname: "reason", fieldtype: "Text", label: "Reason", mandatory_depends_on: "eval:doc.type=='debit'" },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { type: "debit", reason: "   " }, builder);
    expect(r.errors.map((x) => [x.field, x.message_key])).toEqual([["reason", "field_mandatory_depends_on"]]);
  });
});

describe("validateEntityDataZod — a required Check must be ticked and a required Rating above 0", () => {
  // The handler stores a missing Check as false and a missing Rating as 0, so the
  // value the validator sees for "not given" is that stored form.
  const validateStored = (field: Record<string, unknown>, value: unknown) => {
    const stored = getFieldTypeHandler(field.fieldtype as never).toStorage(value, field as never);
    builder.invalidate("TestDoc");
    return validateEntityDataZod(entity([field]), { [field.fieldname as string]: stored }, builder);
  };
  const keys = (r: ReturnType<typeof validateStored>) => r.errors.map((e) => [e.field, e.message_key]);
  const check = { fieldname: "f", fieldtype: "Check", label: "F" };
  const rating = { fieldname: "f", fieldtype: "Rating", label: "F" };

  it("a required Check refuses a missing value and an unticked box with field_required", () => {
    for (const value of [null, undefined, false, 0]) {
      expect(keys(validateStored({ ...check, required: true }, value))).toEqual([["f", "field_required"]]);
    }
  });

  it("a required Check accepts a ticked box", () => {
    for (const value of [true, 1]) expect(validateStored({ ...check, required: true }, value).errors).toEqual([]);
  });

  it("a required Rating refuses a missing value and 0 with field_required", () => {
    for (const value of [null, undefined, 0, "0"]) {
      expect(keys(validateStored({ ...rating, required: true }, value))).toEqual([["f", "field_required"]]);
    }
  });

  it("a required Rating accepts a value above 0 and still refuses one above 1", () => {
    expect(validateStored({ ...rating, required: true }, 0.2).errors).toEqual([]);
    expect(keys(validateStored({ ...rating, required: true }, 5))).toEqual([["f", "field_invalid_rating"]]);
  });

  it("an optional Check accepts an unticked box and an optional Rating accepts 0", () => {
    for (const value of [null, false]) expect(validateStored(check, value).errors).toEqual([]);
    for (const value of [null, 0]) expect(validateStored(rating, value).errors).toEqual([]);
  });

  it("a required Check or Rating cell of a Table row refuses an unticked box and 0", () => {
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [
          { fieldname: "agreed", fieldtype: "Check", label: "Agreed", required: true },
          { fieldname: "score", fieldtype: "Rating", label: "Score", required: true },
        ],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { lines: [{ agreed: 1, score: 0.4 }, { agreed: 0, score: 0 }] }, builder);
    expect(keys(r)).toEqual([
      ["lines[1].agreed", "field_required"],
      ["lines[1].score", "field_required"],
    ]);
  });

  it("a Check or Rating whose mandatory_depends_on holds refuses an unticked box and 0", () => {
    const e = entity([
      { fieldname: "type", fieldtype: "Data", label: "Type" },
      { fieldname: "agreed", fieldtype: "Check", label: "Agreed", mandatory_depends_on: "eval:doc.type=='loan'" },
      { fieldname: "score", fieldtype: "Rating", label: "Score", mandatory_depends_on: "eval:doc.type=='loan'" },
    ]);
    builder.invalidate("TestDoc");
    expect(keys(validateEntityDataZod(e, { type: "loan", agreed: false, score: 0 }, builder))).toEqual([
      ["agreed", "field_mandatory_depends_on"],
      ["score", "field_mandatory_depends_on"],
    ]);
    builder.invalidate("TestDoc");
    expect(validateEntityDataZod(e, { type: "sale", agreed: false, score: 0 }, builder).errors).toEqual([]);
  });
});

describe("validateEntityDataZod — a failed rule answers the key it names", () => {
  const cases: Array<[string, Record<string, unknown>, unknown, string, Record<string, string>?]> = [
    ["regex with regex_message", { fieldtype: "Data", regex: "^[0-9-]{10,17}$", regex_message: "isbn_invalid" }, "abc", "isbn_invalid"],
    ["regex", { fieldtype: "Data", regex: "^[0-9-]{10,17}$" }, "abc", "field_invalid_regex"],
    ["Select option", { fieldtype: "Select", options: ["draft", "done"] }, "gone", "field_invalid_select", { value: "gone" }],
    ["Email", { fieldtype: "Data", options: "Email" }, "no-at-sign", "field_invalid_email"],
    ["URL", { fieldtype: "Data", options: "URL" }, "not a url", "field_invalid_url"],
    ["Phone", { fieldtype: "Data", options: "Phone" }, "call me", "field_invalid_phone"],
    ["IP", { fieldtype: "Data", options: "IP" }, "localhost", "field_invalid_ip"],
    ["min_length", { fieldtype: "Data", min_length: 3 }, "ab", "field_min_length", { min: "3" }],
    ["max_length", { fieldtype: "Data", max_length: 3 }, "abcd", "field_max_length", { max: "3" }],
    ["min_value", { fieldtype: "Int", min_value: 3 }, 1, "field_min_value", { min: "3" }],
    ["max_value", { fieldtype: "Float", max_value: 3 }, 5, "field_max_value", { max: "3" }],
    ["non_negative", { fieldtype: "Float", non_negative: true }, -1, "field_non_negative", { min: "0" }],
    ["Rating", { fieldtype: "Rating" }, 5, "field_invalid_rating", { max: "1" }],
    ["Duration", { fieldtype: "Duration" }, 1.5, "field_invalid_duration"],
    ["Color", { fieldtype: "Color" }, "red", "field_invalid_color"],
    ["Time", { fieldtype: "Time" }, "25:00", "field_invalid_time"],
    ["Date", { fieldtype: "Date" }, "30.09.2026", "field_invalid_date"],
    ["Datetime", { fieldtype: "Datetime" }, "not a time", "field_invalid_date"],
    ["Attach with a script URL", { fieldtype: "Attach" }, "javascript:alert(1)", "field_invalid_url"],
    ["Int given text", { fieldtype: "Int" }, "abc", "field_invalid_type"],
  ];
  for (const [rule, field, value, key, params] of cases) {
    it(`${rule} answers ${key}`, () => {
      builder.invalidate("TestDoc");
      const r = validateEntityDataZod(entity([{ fieldname: "f", label: "F", ...field }]), { f: value }, builder);
      expect(r.errors.map((e) => [e.field, e.message_key])).toEqual([["f", key]]);
      expect(r.errors[0]?.params).toEqual({ field: "f", ...params });
    });
  }

  it("a Table row count answers table_min_rows and table_max_rows with the bound", () => {
    const e = entity([
      { fieldname: "lines", fieldtype: "Table", label: "Lines", min_rows: 2, max_rows: 3, child_fields: [] },
    ]);
    builder.invalidate("TestDoc");
    const few = validateEntityDataZod(e, { lines: [{}] }, builder).errors;
    expect(few.map((x) => [x.field, x.message_key, x.params])).toEqual([["lines", "table_min_rows", { field: "lines", min: "2" }]]);
    const many = validateEntityDataZod(e, { lines: [{}, {}, {}, {}] }, builder).errors;
    expect(many.map((x) => [x.field, x.message_key, x.params])).toEqual([["lines", "table_max_rows", { field: "lines", max: "3" }]]);
  });

  it("a Table cell answers the key of its own rule on the cell's path", () => {
    const e = entity([
      {
        fieldname: "lines",
        fieldtype: "Table",
        label: "Lines",
        child_fields: [{ fieldname: "qty", fieldtype: "Int", label: "Qty", min_value: 1 }],
      },
    ]);
    builder.invalidate("TestDoc");
    const r = validateEntityDataZod(e, { lines: [{ qty: 0 }] }, builder);
    expect(r.errors.map((x) => [x.field, x.message_key])).toEqual([["lines[0].qty", "field_min_value"]]);
  });
});
