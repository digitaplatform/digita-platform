// The fields a read answers to a reader, decided once for the engine and the report service: a
// field above every level the reader's rows hold, or outside a row's `fields`, is not answered.
import { describe, expect, it } from "vitest";
import { readableChildFields, readableFields, type ReadField } from "../src/index.js";

const customer: ReadField[] = [
  { fieldname: "name" },
  { fieldname: "credit_limit", perm_level: 1 },
  { fieldname: "contacts", child_fields: [{ fieldname: "phone" }, { fieldname: "private_note", perm_level: 1 }] },
];

describe("readableFields", () => {
  it("PLANTED DEFECT: answers no field above the levels the reader's rows hold", () => {
    const fields = readableFields(customer, [{ level: 0 }]);
    expect(fields.has("name")).toBe(true);
    expect(fields.has("credit_limit")).toBe(false);
    expect(readableFields(customer, [{ level: 0 }, { level: 1 }]).has("credit_limit")).toBe(true);
  });

  it("answers only the fields a row with `fields` names, and then no operator field", () => {
    const fields = readableFields(customer, [{ level: 0, fields: ["name"] }]);
    expect([...fields].sort()).toEqual(["_id", "creation", "deleted", "docstatus", "doctype", "modified", "name"]);
    expect(readableFields(customer, [{ level: 0 }]).has("owner")).toBe(true);
  });
});

describe("readableChildFields", () => {
  it("PLANTED DEFECT: answers no child above the levels the reader's rows hold", () => {
    expect([...readableChildFields(customer[2]!, [{ level: 0 }])!].sort()).toEqual(["_row_id", "idx", "phone"]);
    expect(readableChildFields(customer[2]!, [{ level: 0 }, { level: 1 }])!.has("private_note")).toBe(true);
  });

  it("leaves a Table without a gated child to its own field", () => {
    expect(readableChildFields({ fieldname: "lines", child_fields: [{ fieldname: "qty" }] }, [{ level: 0 }])).toBeNull();
  });
});
