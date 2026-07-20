import { describe, it, expect } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import {
  coerceDateFilterValues,
  coerceMatchDates,
} from "../src/core/database/filter-value-coercer.js";
import { FieldValueError } from "../src/core/entity/field-types.js";

const entity = {
  name: "Doc",
  fields: [
    { fieldname: "posting_date", fieldtype: "Date" },
    { fieldname: "created_at", fieldtype: "Datetime" },
    { fieldname: "title", fieldtype: "Data" },
    {
      fieldname: "lines",
      fieldtype: "Table",
      child_fields: [{ fieldname: "due_date", fieldtype: "Date" }],
    },
  ],
} as unknown as EntityDefinition;

const coerce = (f: [string, string, unknown][]) => coerceDateFilterValues(entity, f);

describe("coerceDateFilterValues — date/datetime filter coercion", () => {
  it("Date field + JS Date value → canonical YYYY-MM-DD string (the $now bug)", () => {
    const out = coerce([["posting_date", ">=", new Date("2026-07-02T10:30:00Z")]]);
    expect(out).toEqual([["posting_date", ">=", "2026-07-02"]]);
  });

  it("Datetime field + string value → BSON Date (the sibling bug)", () => {
    const out = coerce([["created_at", ">=", "2026-07-01"]])!;
    expect(out[0]![2]).toBeInstanceOf(Date);
    expect((out[0]![2] as Date).toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("Datetime field + Date value → left as a Date (already correct)", () => {
    const d = new Date("2026-07-01T00:00:00Z");
    expect(coerce([["created_at", "<", d]])![0]![2]).toBe(d);
  });

  it("creation/modified meta fields are treated as Datetime", () => {
    const out = coerce([["creation", ">=", "2026-07-01"]])!;
    expect(out[0]![2]).toBeInstanceOf(Date);
  });

  it("non-date field is untouched", () => {
    expect(coerce([["title", "=", "hello"]])).toEqual([["title", "=", "hello"]]);
  });

  it("text/presence operators on a date field are untouched (like/is/exists)", () => {
    const d = new Date("2026-07-02T00:00:00Z");
    expect(coerce([["posting_date", "like", "2026"]])).toEqual([["posting_date", "like", "2026"]]);
    expect(coerce([["posting_date", "is", "set"]])).toEqual([["posting_date", "is", "set"]]);
    // an object filter never gets a like on a real date, but verify no coercion regardless
    expect(coerce([["created_at", "is", "not null"]])).toEqual([["created_at", "is", "not null"]]);
    void d;
  });

  it("array operators (in / between) coerce element-wise", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-12-31T00:00:00Z");
    expect(coerce([["posting_date", "between", [a, b]]])).toEqual([
      ["posting_date", "between", ["2026-01-01", "2026-12-31"]],
    ]);
    expect(coerce([["posting_date", "in", [a, b]]])).toEqual([
      ["posting_date", "in", ["2026-01-01", "2026-12-31"]],
    ]);
  });

  it("child table.child path resolves the child fieldtype", () => {
    expect(coerce([["lines.due_date", "<=", new Date("2026-07-02T23:00:00Z")]])).toEqual([
      ["lines.due_date", "<=", "2026-07-02"],
    ]);
  });

  it("an uncoercible datetime string fails LOUD (FieldValueError → 400)", () => {
    expect(() => coerce([["created_at", ">=", "not-a-date"]])).toThrow(FieldValueError);
  });

  it("null / empty-string values pass through (presence semantics)", () => {
    expect(coerce([["created_at", "=", null]])).toEqual([["created_at", "=", null]]);
    expect(coerce([["posting_date", "=", ""]])).toEqual([["posting_date", "=", ""]]);
  });

  it("undefined / empty filter list passes through", () => {
    expect(coerceDateFilterValues(entity, undefined)).toBeUndefined();
    expect(coerceDateFilterValues(entity, [])).toEqual([]);
  });
});

describe("coerceMatchDates — aggregate $match coercion", () => {
  it("coerces a range operator object on a Date field ($now bug in a pipeline)", () => {
    const out = coerceMatchDates(entity, {
      posting_date: { $gte: new Date("2026-07-02T10:00:00Z"), $lte: new Date("2026-07-09T10:00:00Z") },
    });
    expect(out).toEqual({ posting_date: { $gte: "2026-07-02", $lte: "2026-07-09" } });
  });

  it("coerces a bare scalar equality on a Date field", () => {
    expect(coerceMatchDates(entity, { posting_date: new Date("2026-07-02T23:00:00Z") })).toEqual({
      posting_date: "2026-07-02",
    });
  });

  it("coerces a string operand on a Datetime field to a Date", () => {
    const out = coerceMatchDates(entity, { created_at: { $gte: "2026-07-01" } });
    expect((out.created_at as { $gte: Date }).$gte).toBeInstanceOf(Date);
  });

  it("descends $and/$or", () => {
    const out = coerceMatchDates(entity, {
      $and: [{ posting_date: { $gte: new Date("2026-07-02T00:00:00Z") } }, { title: "x" }],
    });
    expect(out).toEqual({ $and: [{ posting_date: { $gte: "2026-07-02" } }, { title: "x" }] });
  });

  it("leaves $expr and non-date fields untouched", () => {
    const m = { $expr: { $gt: ["$a", "$b"] }, title: { $regex: "x" } };
    expect(coerceMatchDates(entity, m)).toEqual(m);
  });

  it("coerces $in array element-wise on a Date field", () => {
    const out = coerceMatchDates(entity, {
      posting_date: { $in: [new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z")] },
    });
    expect(out).toEqual({ posting_date: { $in: ["2026-01-01", "2026-02-01"] } });
  });
});
