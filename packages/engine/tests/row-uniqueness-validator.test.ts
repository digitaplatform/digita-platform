import { describe, it, expect } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import { validateRowUniqueness } from "../src/core/entity/row-uniqueness-validator.js";

function entity(rowUnique: string[][]): EntityDefinition {
  return {
    name: "Customer",
    module: "test",
    database: "app",
    naming: { strategy: "user_set" },
    fields: [
      {
        fieldname: "addresses",
        fieldtype: "Table",
        label: "Addresses",
        row_unique: rowUnique,
        child_fields: [
          { fieldname: "purpose", fieldtype: "Select", label: "Purpose" },
          { fieldname: "is_default", fieldtype: "Check", label: "Default" },
          { fieldname: "city", fieldtype: "Data", label: "City" },
        ],
      },
    ],
    permissions: [],
  } as unknown as EntityDefinition;
}

describe("validateRowUniqueness", () => {
  it("rejects two rows with the same compound key", () => {
    const errs = validateRowUniqueness(entity([["purpose", "is_default"]]), {
      addresses: [
        { purpose: "invoice", is_default: true, city: "Berlin" },
        { purpose: "invoice", is_default: true, city: "Munich" },
      ],
    });
    expect(errs.length).toBe(1);
    expect(errs[0]!.field).toBe("addresses[1]");
    expect(errs[0]!.message_key).toBe("table_row_unique_violation");
    // A person counts rows from 1.
    expect(errs[0]!.params).toEqual({ field: "Addresses", rows: "1,2", keys: "purpose, is_default" });
  });

  it("names a row repeated by its row id with 1-based rows and without the engine's id field", () => {
    const errs = validateRowUniqueness(entity([]), {
      addresses: [{ _row_id: "r1", city: "Berlin" }, { _row_id: "r2", city: "Bern" }, { _row_id: "r1", city: "Munich" }],
    });
    expect(errs).toEqual([
      {
        field: "addresses[2]",
        message_key: "table_row_repeated",
        message: "Addresses rows 1 and 3 are the same row twice",
        params: { field: "Addresses", rows: "1,3" },
      },
    ]);
    expect(JSON.stringify(errs)).not.toContain("_row_id");
  });

  it("allows distinct combinations", () => {
    const errs = validateRowUniqueness(entity([["purpose", "is_default"]]), {
      addresses: [
        { purpose: "invoice", is_default: true },
        { purpose: "invoice", is_default: false },
        { purpose: "delivery", is_default: true },
      ],
    });
    expect(errs).toEqual([]);
  });

  it("treats null/undefined as the same value (caught as duplicate)", () => {
    const errs = validateRowUniqueness(entity([["purpose"]]), {
      addresses: [
        { purpose: undefined },
        { purpose: null },
      ],
    });
    expect(errs.length).toBe(1);
  });

  it("supports multiple compound keys on one Table", () => {
    const errs = validateRowUniqueness(
      entity([["purpose"], ["city"]]),
      {
        addresses: [
          { purpose: "invoice", city: "Berlin" },
          { purpose: "invoice", city: "Munich" }, // duplicate purpose
        ],
      },
    );
    expect(errs.length).toBe(1);
    expect(errs[0]!.params!["keys"]).toBe("purpose");
  });

  it("no-op when row_unique not declared", () => {
    const e = entity([]) as EntityDefinition;
    delete (e.fields[0] as { row_unique?: string[][] }).row_unique;
    const errs = validateRowUniqueness(e, {
      addresses: [{ purpose: "invoice" }, { purpose: "invoice" }],
    });
    expect(errs).toEqual([]);
  });

  it("no-op when fewer than 2 rows", () => {
    const errs = validateRowUniqueness(entity([["purpose"]]), {
      addresses: [{ purpose: "invoice" }],
    });
    expect(errs).toEqual([]);
  });
});
