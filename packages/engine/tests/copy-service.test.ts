import { describe, it, expect } from "vitest";
import type { EntityDefinition } from "@digitaplatform/shared";
import { copyDocumentData } from "../src/core/document/copy-service.js";

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("copyDocumentData", () => {
  // ── Basic copy ────────────────────────────────────────────────────────────

  it("copies standard fields by value", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "description", fieldtype: "Text", label: "Description" },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount" },
      ],
    });
    const source = { title: "Hello", description: "World", amount: 123 };
    const copy = copyDocumentData(entity, source);
    expect(copy.title).toBe("Hello");
    expect(copy.description).toBe("World");
    expect(copy.amount).toBe(123);
  });

  it("preserves undefined when source field is missing", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    });
    const copy = copyDocumentData(entity, {});
    expect("title" in copy).toBe(true);
    expect(copy.title).toBeUndefined();
  });

  // ── _id is removed ───────────────────────────────────────────────────────

  it("deletes _id from the copy", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    });
    const source = { _id: "original-id", title: "Test" };
    const copy = copyDocumentData(entity, source);
    expect("_id" in copy).toBe(false);
  });

  // ── docstatus reset ───────────────────────────────────────────────────────

  it("sets docstatus to 0 even when source docstatus is non-zero", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
    });
    const source = { title: "T", docstatus: 1 };
    const copy = copyDocumentData(entity, source);
    expect(copy.docstatus).toBe(0);
  });

  it("skips the docstatus field during field iteration and sets it to 0 at end", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "docstatus", fieldtype: "Int", label: "DocStatus" },
      ],
    });
    const source = { title: "T", docstatus: 2 };
    const copy = copyDocumentData(entity, source);
    expect(copy.docstatus).toBe(0);
  });

  // ── no_copy fields ────────────────────────────────────────────────────────

  it("skips fields marked no_copy", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "serial_no", fieldtype: "Data", label: "Serial No", no_copy: true },
      ],
    });
    const source = { title: "Hello", serial_no: "SN-001" };
    const copy = copyDocumentData(entity, source);
    expect(copy.title).toBe("Hello");
    expect("serial_no" in copy).toBe(false);
  });

  it("skips multiple no_copy fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "name", fieldtype: "Data", label: "Name", no_copy: true },
        { fieldname: "ref", fieldtype: "Data", label: "Ref", no_copy: true },
        { fieldname: "notes", fieldtype: "Text", label: "Notes" },
      ],
    });
    const source = { name: "N-001", ref: "R-001", notes: "some notes" };
    const copy = copyDocumentData(entity, source);
    expect("name" in copy).toBe(false);
    expect("ref" in copy).toBe(false);
    expect(copy.notes).toBe("some notes");
  });

  // ── layout fields skipped ─────────────────────────────────────────────────

  it("skips SectionBreak layout fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "section_details", fieldtype: "SectionBreak", label: "Details" },
        { fieldname: "title", fieldtype: "Data", label: "Title" },
      ],
    });
    const source = { section_details: "some value", title: "Hello" };
    const copy = copyDocumentData(entity, source);
    expect("section_details" in copy).toBe(false);
    expect(copy.title).toBe("Hello");
  });

  it("skips ColumnBreak layout fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "col1", fieldtype: "ColumnBreak", label: "Col1" },
        { fieldname: "amount", fieldtype: "Currency", label: "Amount" },
      ],
    });
    const source = { col1: "x", amount: 500 };
    const copy = copyDocumentData(entity, source);
    expect("col1" in copy).toBe(false);
    expect(copy.amount).toBe(500);
  });

  it("skips TabBreak layout fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "my_tab", fieldtype: "TabBreak", label: "Tab" },
        { fieldname: "status", fieldtype: "Select", label: "Status" },
      ],
    });
    const source = { my_tab: "ignored", status: "Active" };
    const copy = copyDocumentData(entity, source);
    expect("my_tab" in copy).toBe(false);
    expect(copy.status).toBe("Active");
  });

  it("skips Heading layout fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "heading1", fieldtype: "Heading", label: "Heading" },
        { fieldname: "value", fieldtype: "Int", label: "Value" },
      ],
    });
    const source = { heading1: "ignored", value: 7 };
    const copy = copyDocumentData(entity, source);
    expect("heading1" in copy).toBe(false);
    expect(copy.value).toBe(7);
  });

  it("skips HTML and Button layout fields", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "html_block", fieldtype: "HTML", label: "HTML" },
        { fieldname: "btn", fieldtype: "Button", label: "Button" },
        { fieldname: "title", fieldtype: "Data", label: "Title" },
      ],
    });
    const source = { html_block: "<p>hi</p>", btn: "click", title: "OK" };
    const copy = copyDocumentData(entity, source);
    expect("html_block" in copy).toBe(false);
    expect("btn" in copy).toBe(false);
    expect(copy.title).toBe("OK");
  });

  // ── Table field — deep copy ───────────────────────────────────────────────

  it("deep copies Table child rows", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [
            { fieldname: "item_code", fieldtype: "Data", label: "Item Code" },
            { fieldname: "qty", fieldtype: "Int", label: "Qty" },
          ],
        },
      ],
    });
    const source = {
      items: [
        { item_code: "ITEM-001", qty: 5 },
        { item_code: "ITEM-002", qty: 10 },
      ],
    };
    const copy = copyDocumentData(entity, source);
    expect(Array.isArray(copy.items)).toBe(true);
    const rows = copy.items as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.item_code).toBe("ITEM-001");
    expect(rows[0]!.qty).toBe(5);
    expect(rows[1]!.item_code).toBe("ITEM-002");
    expect(rows[1]!.qty).toBe(10);
  });

  it("resets idx on each child row based on array position", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [
            { fieldname: "item_code", fieldtype: "Data", label: "Item Code" },
          ],
        },
      ],
    });
    const source = {
      items: [
        { item_code: "A", idx: 99 },
        { item_code: "B", idx: 42 },
        { item_code: "C", idx: 7 },
      ],
    };
    const copy = copyDocumentData(entity, source);
    const rows = copy.items as Record<string, unknown>[];
    expect(rows[0]!.idx).toBe(0);
    expect(rows[1]!.idx).toBe(1);
    expect(rows[2]!.idx).toBe(2);
  });

  it("respects no_copy on child fields inside Table rows", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "lines",
          fieldtype: "Table",
          label: "Lines",
          child_fields: [
            { fieldname: "description", fieldtype: "Data", label: "Description" },
            { fieldname: "internal_ref", fieldtype: "Data", label: "Internal Ref", no_copy: true },
          ],
        },
      ],
    });
    const source = {
      lines: [
        { description: "Widget", internal_ref: "INT-001" },
      ],
    };
    const copy = copyDocumentData(entity, source);
    const rows = copy.lines as Record<string, unknown>[];
    expect(rows[0]!.description).toBe("Widget");
    expect("internal_ref" in rows[0]!).toBe(false);
  });

  it("skips layout fields within child_fields of a Table", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [
            { fieldname: "sec", fieldtype: "SectionBreak", label: "Section" },
            { fieldname: "product", fieldtype: "Data", label: "Product" },
          ],
        },
      ],
    });
    const source = {
      items: [{ sec: "ignored", product: "Widget" }],
    };
    const copy = copyDocumentData(entity, source);
    const rows = copy.items as Record<string, unknown>[];
    expect("sec" in rows[0]!).toBe(false);
    expect(rows[0]!.product).toBe("Widget");
  });

  it("produces independent deep copies — mutating original does not affect copy", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [
            { fieldname: "qty", fieldtype: "Int", label: "Qty" },
          ],
        },
      ],
    });
    const sourceRows = [{ qty: 3 }];
    const source = { items: sourceRows };
    const copy = copyDocumentData(entity, source);
    // Mutate the copy rows
    (copy.items as Record<string, unknown>[])[0]!.qty = 999;
    // Original should be unchanged
    expect(sourceRows[0]!.qty).toBe(3);
  });

  it("handles Table with no value in source (undefined)", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [{ fieldname: "qty", fieldtype: "Int", label: "Qty" }],
        },
      ],
    });
    const copy = copyDocumentData(entity, {});
    // Undefined table value copied as-is (non-array path)
    expect(copy.items).toBeUndefined();
  });

  it("handles Table with empty array", () => {
    const entity = makeEntity({
      fields: [
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [{ fieldname: "qty", fieldtype: "Int", label: "Qty" }],
        },
      ],
    });
    const copy = copyDocumentData(entity, { items: [] });
    expect(copy.items).toEqual([]);
  });

  // ── Combined scenario ─────────────────────────────────────────────────────

  it("full scenario: copies allowed fields, skips layout/no_copy/docstatus, resets _id, sets docstatus=0", () => {
    const entity = makeEntity({
      fields: [
        { fieldname: "sec", fieldtype: "SectionBreak", label: "Section" },
        { fieldname: "title", fieldtype: "Data", label: "Title" },
        { fieldname: "serial", fieldtype: "Data", label: "Serial", no_copy: true },
        { fieldname: "docstatus", fieldtype: "Int", label: "DocStatus" },
        {
          fieldname: "items",
          fieldtype: "Table",
          label: "Items",
          child_fields: [
            { fieldname: "product", fieldtype: "Data", label: "Product" },
            { fieldname: "batch", fieldtype: "Data", label: "Batch", no_copy: true },
          ],
        },
      ],
    });
    const source = {
      _id: "DOC-001",
      sec: "ignored",
      title: "My Document",
      serial: "SN-XYZ",
      docstatus: 1,
      items: [{ product: "Widget", batch: "BATCH-01", idx: 5 }],
    };
    const copy = copyDocumentData(entity, source);

    expect("_id" in copy).toBe(false);
    expect("sec" in copy).toBe(false);
    expect("serial" in copy).toBe(false);
    expect(copy.title).toBe("My Document");
    expect(copy.docstatus).toBe(0);

    const rows = copy.items as Record<string, unknown>[];
    expect(rows[0]!.product).toBe("Widget");
    expect("batch" in rows[0]!).toBe(false);
    expect(rows[0]!.idx).toBe(0);
  });

  // ── Table WITHOUT child_fields — rows pass through (not wiped to {idx}) ──────

  it("passes child rows through when the Table declares no child_fields", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "items", fieldtype: "Table", label: "Items" }],
    });
    const source = {
      items: [
        { item_code: "A", qty: 5, _row_id: "rid1", idx: 9 },
        { item_code: "B", qty: 7, _row_id: "rid2", idx: 3 },
      ],
    };
    const copy = copyDocumentData(entity, source);
    const rows = copy.items as Record<string, unknown>[];
    expect(rows[0]!.item_code).toBe("A");
    expect(rows[0]!.qty).toBe(5);
    expect(rows[1]!.item_code).toBe("B");
    // idx re-stamped to array position; stable _row_id dropped for re-stamping.
    expect(rows[0]!.idx).toBe(0);
    expect(rows[1]!.idx).toBe(1);
    expect("_row_id" in rows[0]!).toBe(false);
  });

  // ── business_key drop (E11000-on-copy fix) ──────────────────────────────────

  it("drops a single business_key field so insert() regenerates it", () => {
    const entity = makeEntity({
      business_key: "doc_no",
      fields: [
        { fieldname: "doc_no", fieldtype: "Data", label: "Doc No" },
        { fieldname: "title", fieldtype: "Data", label: "Title" },
      ],
    } as Partial<EntityDefinition>);
    const copy = copyDocumentData(entity, { doc_no: "DOC-00001", title: "Invoice" });
    expect("doc_no" in copy).toBe(false);
    expect(copy.title).toBe("Invoice");
  });

  it("drops every field of an array business_key", () => {
    const entity = makeEntity({
      business_key: ["series", "year"],
      fields: [
        { fieldname: "series", fieldtype: "Data", label: "Series" },
        { fieldname: "year", fieldtype: "Data", label: "Year" },
        { fieldname: "title", fieldtype: "Data", label: "Title" },
      ],
    } as Partial<EntityDefinition>);
    const copy = copyDocumentData(entity, { series: "INV", year: "2026", title: "X" });
    expect("series" in copy).toBe(false);
    expect("year" in copy).toBe(false);
    expect(copy.title).toBe("X");
  });

  // ── workflow-state reset on copy ────────────────────────────────────────────

  it("resets the workflow field to the is_initial state", () => {
    const entity = makeEntity({
      workflow_field: "status",
      states: [
        { value: "Draft", color: "gray", is_initial: true },
        { value: "Approved", color: "green" },
      ],
      fields: [{ fieldname: "status", fieldtype: "Select", label: "Status" }],
    } as Partial<EntityDefinition>);
    const copy = copyDocumentData(entity, { status: "Approved" });
    expect(copy.status).toBe("Draft");
  });

  it("resets a custom workflow_field to its is_initial state", () => {
    const entity = makeEntity({
      workflow_field: "stage",
      states: [
        { value: "New", color: "gray", is_initial: true },
        { value: "Done", color: "green" },
      ],
      fields: [{ fieldname: "stage", fieldtype: "Select", label: "Stage" }],
    } as Partial<EntityDefinition>);
    const copy = copyDocumentData(entity, { stage: "Done" });
    expect(copy.stage).toBe("New");
  });

  it("leaves a plain status field untouched when the entity declares no states", () => {
    const entity = makeEntity({
      fields: [{ fieldname: "status", fieldtype: "Select", label: "Status" }],
    });
    const copy = copyDocumentData(entity, { status: "Active" });
    expect(copy.status).toBe("Active");
  });
});
