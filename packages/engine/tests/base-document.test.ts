import { describe, it, expect, beforeEach } from "vitest";
import { BaseDocument } from "../src/core/document/base-document.js";

// ─── Construction ──────────────────────────────────────────────────────────

describe("BaseDocument – construction", () => {
  it("sets doctype and marks document as new when no data is provided", () => {
    const doc = new BaseDocument("Invoice");
    expect(doc.doctype).toBe("Invoice");
    expect(doc._isNew).toBe(true);
    expect(doc._dirty.size).toBe(0);
  });

  it("calls loadFromData when initial data is supplied", () => {
    const data = { _id: "INV-001", doctype: "Invoice", owner: "admin" };
    const doc = new BaseDocument("Invoice", data);
    expect(doc._id).toBe("INV-001");
    expect(doc.owner).toBe("admin");
    expect(doc._isNew).toBe(false);
  });

  it("initialises standard fields with sensible defaults when no data", () => {
    const doc = new BaseDocument("Order");
    expect(doc._id).toBe("");
    expect(doc.docstatus).toBe(0);
    expect(doc.owner).toBe("");
    expect(doc.modified_by).toBe("");
    expect(doc.creation).toBeInstanceOf(Date);
    expect(doc.modified).toBeInstanceOf(Date);
  });
});

// ─── loadFromData ──────────────────────────────────────────────────────────

describe("BaseDocument – loadFromData", () => {
  let doc: BaseDocument;

  beforeEach(() => {
    doc = new BaseDocument("Invoice");
  });

  it("populates all standard fields", () => {
    const creation = new Date("2024-01-01T00:00:00Z");
    const modified = new Date("2024-06-01T00:00:00Z");

    doc.loadFromData({
      _id: "INV-001",
      doctype: "Invoice",
      docstatus: 1,
      owner: "alice",
      modified_by: "bob",
      creation,
      modified,
    });

    expect(doc._id).toBe("INV-001");
    expect(doc.doctype).toBe("Invoice");
    expect(doc.docstatus).toBe(1);
    expect(doc.owner).toBe("alice");
    expect(doc.modified_by).toBe("bob");
    expect(doc.creation).toBe(creation);
    expect(doc.modified).toBe(modified);
  });

  it("parses date strings for creation and modified", () => {
    doc.loadFromData({
      _id: "INV-002",
      creation: "2024-01-15T10:00:00Z",
      modified: "2024-02-20T12:30:00Z",
    });

    expect(doc.creation).toBeInstanceOf(Date);
    expect(doc.modified).toBeInstanceOf(Date);
    expect(doc.creation.toISOString()).toBe("2024-01-15T10:00:00.000Z");
    expect(doc.modified.toISOString()).toBe("2024-02-20T12:30:00.000Z");
  });

  it("clears dirty state and sets _isNew to false", () => {
    // Dirty up the document first
    doc.set("amount", 999);
    expect(doc._dirty.size).toBeGreaterThan(0);

    doc.loadFromData({ _id: "INV-003" });

    expect(doc._dirty.size).toBe(0);
    expect(doc._isNew).toBe(false);
  });

  it("snapshots _original to match _data after load", () => {
    doc.loadFromData({ _id: "INV-004", amount: 500, currency: "EUR" });

    expect(doc._original["amount"]).toBe(500);
    expect(doc._original["currency"]).toBe("EUR");
    // _data and _original are separate copies
    expect(doc._data).not.toBe(doc._original);
  });

  it("uses doctype fallback when doctype not present in data", () => {
    const doc2 = new BaseDocument("Fallback");
    doc2.loadFromData({ _id: "X-001" });
    expect(doc2.doctype).toBe("Fallback");
  });
});

// ─── get / set ─────────────────────────────────────────────────────────────

describe("BaseDocument – get / set", () => {
  let doc: BaseDocument;

  beforeEach(() => {
    doc = new BaseDocument("Item", { _id: "ITEM-001", price: 10 });
  });

  it("get returns the stored field value", () => {
    expect(doc.get("price")).toBe(10);
  });

  it("get returns undefined for unknown fields", () => {
    expect(doc.get("nonexistent")).toBeUndefined();
  });

  it("set stores the new value", () => {
    doc.set("price", 20);
    expect(doc.get("price")).toBe(20);
  });

  it("set marks the field as dirty", () => {
    doc.set("price", 20);
    expect(doc._dirty.has("price")).toBe(true);
  });

  it("set does NOT mark as dirty when value is unchanged", () => {
    // price is 10 from loaded data
    doc.set("price", 10);
    expect(doc._dirty.has("price")).toBe(false);
  });

  it("set tracks multiple distinct fields", () => {
    doc.set("price", 20);
    doc.set("qty", 5);
    expect(doc._dirty.size).toBe(2);
  });

  // ── Reference-equality semantics for objects/arrays ────────────────────
  // Critical because in-place child-row mutation would otherwise silently
  // drop changes on UPDATE (getChanges() omits non-dirty fields).

  it("set ALWAYS marks dirty for arrays — even with same reference", () => {
    const child = new BaseDocument("Order", { _id: "O-1", lines: [{ qty: 1 }] });
    const lines = child.getChildren("lines");        // same ref as _data["lines"]
    lines[0]!["qty"] = 99;                            // in-place mutation
    child.set("lines", lines);                        // pass same ref back
    expect(child._dirty.has("lines")).toBe(true);
  });

  it("set ALWAYS marks dirty for plain objects — even with same reference", () => {
    const obj = { foo: "bar" };
    const target = new BaseDocument("Doc", { _id: "D-1", meta: obj });
    target.set("meta", obj);                          // same ref
    expect(target._dirty.has("meta")).toBe(true);
  });

  it("set marks dirty for arrays with new reference", () => {
    doc.set("tags", ["a", "b"]);
    expect(doc._dirty.has("tags")).toBe(true);
  });

  it("set still de-dups primitive same-value writes", () => {
    doc.set("price", 10);                              // matches loaded value
    expect(doc._dirty.has("price")).toBe(false);
  });

  it("set marks dirty for null → object transition", () => {
    const target = new BaseDocument("Doc", { _id: "D-1", meta: null });
    target.set("meta", { key: "value" });
    expect(target._dirty.has("meta")).toBe(true);
  });

  it("set marks dirty for object → null transition", () => {
    const target = new BaseDocument("Doc", { _id: "D-1", meta: { key: "value" } });
    target.set("meta", null);
    expect(target._dirty.has("meta")).toBe(true);
  });
});

// ─── merge ─────────────────────────────────────────────────────────────────

describe("BaseDocument – merge", () => {
  let doc: BaseDocument;

  beforeEach(() => {
    doc = new BaseDocument("Item", { _id: "ITEM-001", price: 10, qty: 2 });
  });

  it("sets all non-underscore fields", () => {
    doc.merge({ price: 50, qty: 3, notes: "bulk" });
    expect(doc.get("price")).toBe(50);
    expect(doc.get("qty")).toBe(3);
    expect(doc.get("notes")).toBe("bulk");
  });

  it("skips fields that start with _ (except _id)", () => {
    doc.merge({ _secret: "hidden", _internal: 99, _id: "ITEM-UPDATED" });
    expect(doc.get("_secret")).toBeUndefined();
    expect(doc.get("_internal")).toBeUndefined();
    // _id is allowed through
    expect(doc.get("_id")).toBe("ITEM-UPDATED");
  });

  it("marks merged fields as dirty", () => {
    doc.merge({ price: 99 });
    expect(doc._dirty.has("price")).toBe(true);
  });

  it("does not dirty unchanged values during merge", () => {
    // price is already 10
    doc.merge({ price: 10 });
    expect(doc._dirty.has("price")).toBe(false);
  });
});

// ─── Change tracking ───────────────────────────────────────────────────────

describe("BaseDocument – change tracking", () => {
  let doc: BaseDocument;

  beforeEach(() => {
    doc = new BaseDocument("Invoice", { _id: "INV-001", amount: 100, status: "draft" });
  });

  it("hasChanged() returns false for a freshly loaded document", () => {
    expect(doc.hasChanged()).toBe(false);
  });

  it("hasChanged() returns true after a field is changed", () => {
    doc.set("amount", 200);
    expect(doc.hasChanged()).toBe(true);
  });

  it("hasChanged(fieldname) checks a specific field", () => {
    doc.set("amount", 200);
    expect(doc.hasChanged("amount")).toBe(true);
    expect(doc.hasChanged("status")).toBe(false);
  });

  it("getChangedFields returns the names of dirty fields", () => {
    doc.set("amount", 200);
    doc.set("status", "submitted");
    const changed = doc.getChangedFields();
    expect(changed).toContain("amount");
    expect(changed).toContain("status");
    expect(changed).toHaveLength(2);
  });

  it("getPreviousValue returns the original value before change", () => {
    doc.set("amount", 200);
    expect(doc.getPreviousValue("amount")).toBe(100);
  });

  it("getPreviousValue returns undefined for fields not in original", () => {
    expect(doc.getPreviousValue("nonexistent")).toBeUndefined();
  });

  it("getChanges returns only changed fields plus modified/modified_by", () => {
    doc.set("amount", 200);
    const changes = doc.getChanges();
    expect(changes["amount"]).toBe(200);
    expect("modified" in changes).toBe(true);
    expect("modified_by" in changes).toBe(true);
    // unchanged field should not appear
    expect("status" in changes).toBe(false);
  });

  it("getChanges always includes modified and modified_by", () => {
    // No fields changed
    const changes = doc.getChanges();
    expect("modified" in changes).toBe(true);
    expect("modified_by" in changes).toBe(true);
  });
});

// ─── Child table helpers ───────────────────────────────────────────────────

describe("BaseDocument – child table helpers", () => {
  let doc: BaseDocument;

  beforeEach(() => {
    doc = new BaseDocument("SalesOrder", { _id: "SO-001", items: [] });
  });

  it("getChildren returns empty array when field is absent", () => {
    expect(doc.getChildren("nonexistent")).toEqual([]);
  });

  it("getChildren returns empty array when field is not an array", () => {
    doc.set("items", "not-an-array");
    expect(doc.getChildren("items")).toEqual([]);
  });

  it("addChild appends a child with correct idx", () => {
    const child1 = doc.addChild("items", { product: "A", qty: 1 });
    const child2 = doc.addChild("items", { product: "B", qty: 2 });

    expect(child1["idx"]).toBe(0);
    expect(child2["idx"]).toBe(1);
    expect(doc.getChildren("items")).toHaveLength(2);
  });

  it("addChild marks the field as dirty", () => {
    doc.addChild("items", { product: "A" });
    expect(doc._dirty.has("items")).toBe(true);
  });

  it("addChild with no data still creates a child with idx", () => {
    const child = doc.addChild("items");
    expect(child["idx"]).toBe(0);
  });

  it("removeChild splices the child at the given index and re-indexes", () => {
    doc.addChild("items", { product: "A" });
    doc.addChild("items", { product: "B" });
    doc.addChild("items", { product: "C" });

    doc.removeChild("items", 1); // remove B

    const children = doc.getChildren("items");
    expect(children).toHaveLength(2);
    expect(children[0]!["product"]).toBe("A");
    expect(children[0]!["idx"]).toBe(0);
    expect(children[1]!["product"]).toBe("C");
    expect(children[1]!["idx"]).toBe(1);
  });

  it("removeChild marks the field as dirty", () => {
    doc.addChild("items", { product: "A" });
    doc._dirty.clear(); // reset dirty

    doc.removeChild("items", 0);
    expect(doc._dirty.has("items")).toBe(true);
  });

  it("clearChildren empties the array and marks field as dirty", () => {
    doc.addChild("items", { product: "A" });
    doc.addChild("items", { product: "B" });
    doc._dirty.clear();

    doc.clearChildren("items");

    expect(doc.getChildren("items")).toHaveLength(0);
    expect(doc._dirty.has("items")).toBe(true);
  });
});

// ─── toJSON ────────────────────────────────────────────────────────────────

describe("BaseDocument – toJSON", () => {
  it("converts dates to ISO strings", () => {
    const creation = new Date("2024-01-01T00:00:00Z");
    const modified = new Date("2024-06-01T00:00:00Z");
    const doc = new BaseDocument("Invoice", {
      _id: "INV-001",
      creation,
      modified,
    });

    const json = doc.toJSON();
    expect(json["creation"]).toBe("2024-01-01T00:00:00.000Z");
    expect(json["modified"]).toBe("2024-06-01T00:00:00.000Z");
  });

  it("includes standard identity and status fields", () => {
    const doc = new BaseDocument("Invoice", { _id: "INV-001", docstatus: 0 });
    const json = doc.toJSON();

    expect(json["_id"]).toBe("INV-001");
    expect(json["doctype"]).toBe("Invoice");
    expect(json["docstatus"]).toBe(0);
  });

  it("omits _link_titles when empty", () => {
    const doc = new BaseDocument("Invoice", { _id: "INV-001" });
    const json = doc.toJSON();
    expect(json["_link_titles"]).toBeUndefined();
  });

  it("includes _link_titles when populated", () => {
    const doc = new BaseDocument("Invoice", { _id: "INV-001" });
    doc._link_titles = { customer: "Acme Corp" };
    const json = doc.toJSON();
    expect(json["_link_titles"]).toEqual({ customer: "Acme Corp" });
  });

  it("includes _status_indicator when set", () => {
    const doc = new BaseDocument("Invoice", { _id: "INV-001" });
    doc._status_indicator = { color: "green" };
    const json = doc.toJSON();
    expect(json["_status_indicator"]).toEqual({ color: "green" });
  });

  it("spreads _data fields into the result", () => {
    const doc = new BaseDocument("Invoice", { _id: "INV-001", amount: 500, currency: "USD" });
    const json = doc.toJSON();
    expect(json["amount"]).toBe(500);
    expect(json["currency"]).toBe("USD");
  });
});

// ─── toMongo ───────────────────────────────────────────────────────────────

describe("BaseDocument – toMongo", () => {
  it("keeps dates as Date objects (not ISO strings)", () => {
    const creation = new Date("2024-01-01T00:00:00Z");
    const modified = new Date("2024-06-01T00:00:00Z");
    const doc = new BaseDocument("Invoice", { _id: "INV-001", creation, modified });

    const mongo = doc.toMongo();
    expect(mongo["creation"]).toBeInstanceOf(Date);
    expect(mongo["modified"]).toBeInstanceOf(Date);
  });

  it("includes all standard fields", () => {
    const doc = new BaseDocument("Invoice", {
      _id: "INV-001",
      docstatus: 0,
      owner: "alice",
      modified_by: "bob",
    });

    const mongo = doc.toMongo();
    expect(mongo["_id"]).toBe("INV-001");
    expect(mongo["doctype"]).toBe("Invoice");
    expect(mongo["docstatus"]).toBe(0);
    expect(mongo["owner"]).toBe("alice");
    expect(mongo["modified_by"]).toBe("bob");
  });

  it("spreads _data fields (overriding standard fields from the spread)", () => {
    // toMongo spreads _data after the standard fields, so _data wins for duplicates
    const doc = new BaseDocument("Invoice", { _id: "INV-001", amount: 750 });
    const mongo = doc.toMongo();
    expect(mongo["amount"]).toBe(750);
  });
});
