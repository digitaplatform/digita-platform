import { describe, it, expect } from "vitest";
import type { FieldDefinition } from "@digitaplatform/shared";
import { getFieldTypeHandler, FieldValueError } from "../src/core/entity/field-types.js";
import { buildFieldSchema } from "../src/core/entity/field-to-zod.js";

/**
 * B1 write-hardening: a `Date` field's canonical storage form is a "YYYY-MM-DD"
 * string. The handler canonicalizes a Date object and rejects any non-canonical
 * string (fail-loud → 400), so a stray value can't later silently mis-compare in a
 * date filter. `Datetime` stays tolerant (parseable string / Date → BSON Date).
 */
const dateField = { fieldname: "d", label: "D", fieldtype: "Date" } as unknown as FieldDefinition;
const dtField = { fieldname: "t", label: "T", fieldtype: "Datetime" } as unknown as FieldDefinition;

describe("Date field toStorage — canonical or fail-loud", () => {
  const h = getFieldTypeHandler("Date");

  it("canonicalizes a Date object to its UTC calendar day", () => {
    expect(h.toStorage(new Date("2026-07-02T22:30:00Z"), dateField)).toBe("2026-07-02");
  });
  it("passes a canonical YYYY-MM-DD string through", () => {
    expect(h.toStorage("2026-07-02", dateField)).toBe("2026-07-02");
  });
  it("empty → null (cleared)", () => {
    expect(h.toStorage("", dateField)).toBeNull();
    expect(h.toStorage(null, dateField)).toBeNull();
  });
  it("rejects a non-canonical string (US format) with FieldValueError", () => {
    expect(() => h.toStorage("07/02/2026", dateField)).toThrow(FieldValueError);
  });
  it("rejects an ISO datetime string on a Date field (must be date-only)", () => {
    expect(() => h.toStorage("2026-07-02T10:00:00Z", dateField)).toThrow(FieldValueError);
  });
  it("rejects a regex-passing but invalid calendar date", () => {
    expect(() => h.toStorage("2026-13-45", dateField)).toThrow(FieldValueError);
  });
});

describe("Date field zod — enforces YYYY-MM-DD", () => {
  const schema = buildFieldSchema(dateField);
  it("accepts a canonical string, a Date object, and empty", () => {
    expect(schema.safeParse("2026-07-02").success).toBe(true);
    expect(schema.safeParse(new Date()).success).toBe(true);
    expect(schema.safeParse("").success).toBe(true);
  });
  it("rejects a non-canonical string", () => {
    expect(schema.safeParse("07/02/2026").success).toBe(false);
    expect(schema.safeParse("2026-07-02T10:00:00Z").success).toBe(false);
  });
});

describe("Datetime field stays tolerant (parseable → BSON Date)", () => {
  const h = getFieldTypeHandler("Datetime");
  const schema = buildFieldSchema(dtField);
  it("stores a parseable string as a Date", () => {
    expect(h.toStorage("2026-07-02T10:00:00Z", dtField)).toBeInstanceOf(Date);
    expect(h.toStorage("2026-07-02", dtField)).toBeInstanceOf(Date);
  });
  it("zod accepts a full ISO datetime", () => {
    expect(schema.safeParse("2026-07-02T10:00:00Z").success).toBe(true);
  });
});
