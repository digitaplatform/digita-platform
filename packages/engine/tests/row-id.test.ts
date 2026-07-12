import { describe, it, expect } from "vitest";
import { ROW_ID_FIELD } from "@digitaplatform/shared";
import { BaseDocument } from "../src/core/document/base-document.js";
import {
  generateRowId,
  buildSubRowLink,
  parseSubRowLink,
} from "../src/core/document/row-id.js";

describe("generateRowId", () => {
  it("returns 16-char hex strings", () => {
    const a = generateRowId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
  it("returns distinct ids each call", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateRowId()));
    expect(ids.size).toBe(1000);
  });
});

describe("BaseDocument addChild — _row_id auto-fill", () => {
  it("assigns a unique _row_id to each row", () => {
    const doc = new BaseDocument("Invoice");
    const a = doc.addChild("lines", { qty: 1 });
    const b = doc.addChild("lines", { qty: 2 });
    expect(typeof a[ROW_ID_FIELD]).toBe("string");
    expect(typeof b[ROW_ID_FIELD]).toBe("string");
    expect(a[ROW_ID_FIELD]).not.toBe(b[ROW_ID_FIELD]);
  });

  it("honors caller-supplied _row_id", () => {
    const doc = new BaseDocument("Invoice");
    const r = doc.addChild("lines", { _row_id: "fixed-001", qty: 1 });
    expect(r[ROW_ID_FIELD]).toBe("fixed-001");
  });

  it("preserves _row_id when reordering / removing other rows", () => {
    const doc = new BaseDocument("Invoice");
    const a = doc.addChild("lines", { qty: 1 });
    const b = doc.addChild("lines", { qty: 2 });
    const c = doc.addChild("lines", { qty: 3 });
    const aId = a[ROW_ID_FIELD] as string;
    const cId = c[ROW_ID_FIELD] as string;
    doc.removeChild("lines", 1); // remove b
    const rows = doc.getChildren("lines");
    expect(rows[0]![ROW_ID_FIELD]).toBe(aId);
    expect(rows[1]![ROW_ID_FIELD]).toBe(cId);
    // idx is re-numbered for display order
    expect(rows[0]!["idx"]).toBe(0);
    expect(rows[1]!["idx"]).toBe(1);
  });
});

describe("BaseDocument getChildById / removeChildById / updateChildById", () => {
  it("getChildById returns the matching row, undefined otherwise", () => {
    const doc = new BaseDocument("Invoice");
    const a = doc.addChild("lines", { qty: 1 });
    const got = doc.getChildById("lines", a[ROW_ID_FIELD] as string);
    expect(got).toBe(doc.getChildren("lines")[0]);
    expect(doc.getChildById("lines", "missing")).toBeUndefined();
  });

  it("removeChildById removes by stable handle", () => {
    const doc = new BaseDocument("Invoice");
    doc.addChild("lines", { qty: 1 });
    const b = doc.addChild("lines", { qty: 2 });
    doc.removeChildById("lines", b[ROW_ID_FIELD] as string);
    expect(doc.getChildren("lines").length).toBe(1);
  });

  it("updateChildById patches by stable handle but cannot change _row_id", () => {
    const doc = new BaseDocument("Invoice");
    const a = doc.addChild("lines", { qty: 1 });
    const id = a[ROW_ID_FIELD] as string;
    const ok = doc.updateChildById("lines", id, { qty: 99, _row_id: "tampered" });
    expect(ok).toBe(true);
    const row = doc.getChildById("lines", id)!;
    expect(row["qty"]).toBe(99);
    expect(row[ROW_ID_FIELD]).toBe(id);
  });

  it("updateChildById returns false on missing row", () => {
    const doc = new BaseDocument("Invoice");
    expect(doc.updateChildById("lines", "missing", { x: 1 })).toBe(false);
  });
});

describe("buildSubRowLink / parseSubRowLink", () => {
  it("round-trips a (parent, row) pair", () => {
    const v = buildSubRowLink("CUST-1", "abc123");
    expect(v).toBe("CUST-1::abc123");
    const parsed = parseSubRowLink(v);
    expect(parsed).toEqual({ parentId: "CUST-1", rowId: "abc123" });
  });

  it("rejects malformed values", () => {
    expect(parseSubRowLink("no-separator")).toBeNull();
    expect(parseSubRowLink("::missing-parent")).toBeNull();
    expect(parseSubRowLink("missing-row::")).toBeNull();
  });
});
