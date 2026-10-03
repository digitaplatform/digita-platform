import { describe, it, expect } from "vitest";
import { opensField, opensOperatorFields } from "../src/types/permissions.js";

// The rule of which fields a read row opens, which the engine and the report service share.
describe("opensField", () => {
  it("opens a field of the row's level", () => {
    expect(opensField({ level: 1 }, "salary", 1)).toBe(true);
  });

  it("opens no field of another level", () => {
    expect(opensField({ level: 0 }, "salary", 1)).toBe(false);
    expect(opensField({ level: 2 }, "salary", 1)).toBe(false);
  });

  it("opens a field its `fields` names, and none it leaves out", () => {
    expect(opensField({ level: 0, fields: ["name", "dept"] }, "name", 0)).toBe(true);
    expect(opensField({ level: 0, fields: ["name", "dept"] }, "phone", 0)).toBe(false);
  });

  it("opens a Table's children of its level through the Table's name", () => {
    expect(opensField({ level: 1, fields: ["lines"] }, "lines", 1)).toBe(true);
  });
});

describe("opensOperatorFields", () => {
  it("opens owner and modified_by through an admitting row without `fields`", () => {
    expect(opensOperatorFields([{ level: 0 }])).toBe(true);
    expect(opensOperatorFields([{ level: 0, fields: ["name"] }, { level: 1 }])).toBe(true);
    expect(opensOperatorFields([{ level: 0, fields: ["name"] }])).toBe(false);
  });

  it("PLANTED DEFECT: opens none to a reader with no read row", () => {
    expect(opensOperatorFields([])).toBe(false);
  });
});
