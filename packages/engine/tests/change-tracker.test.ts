import { describe, it, expect, beforeEach } from "vitest";
import { BaseDocument } from "../src/core/document/base-document.js";
import { calculateChanges } from "../src/core/document/change-tracker.js";
import type { FieldChange } from "../src/core/document/change-tracker.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeDoc(initial: Record<string, unknown>): BaseDocument {
  return new BaseDocument("TestDoc", initial);
}

function findChange(changes: FieldChange[], field: string): FieldChange | undefined {
  return changes.find((c) => c.field === field);
}

// ─── Primitive changes ─────────────────────────────────────────────────────

describe("calculateChanges – primitive changes", () => {
  it("reports a changed string field", () => {
    const doc = makeDoc({ _id: "DOC-001", status: "draft" });
    doc.set("status", "submitted");

    const changes = calculateChanges(doc);
    const change = findChange(changes, "status");

    expect(change).toBeDefined();
    expect(change!.old).toBe("draft");
    expect(change!.new).toBe("submitted");
  });

  it("reports a changed number field", () => {
    const doc = makeDoc({ _id: "DOC-001", amount: 100 });
    doc.set("amount", 200);

    const changes = calculateChanges(doc);
    const change = findChange(changes, "amount");

    expect(change).toBeDefined();
    expect(change!.old).toBe(100);
    expect(change!.new).toBe(200);
  });

  it("reports a changed boolean field", () => {
    const doc = makeDoc({ _id: "DOC-001", active: true });
    doc.set("active", false);

    const changes = calculateChanges(doc);
    const change = findChange(changes, "active");

    expect(change).toBeDefined();
    expect(change!.old).toBe(true);
    expect(change!.new).toBe(false);
  });

  it("reports multiple changed fields", () => {
    const doc = makeDoc({ _id: "DOC-001", name: "Alice", age: 30 });
    doc.set("name", "Bob");
    doc.set("age", 31);

    const changes = calculateChanges(doc);
    expect(changes).toHaveLength(2);
    expect(findChange(changes, "name")).toBeDefined();
    expect(findChange(changes, "age")).toBeDefined();
  });
});

// ─── No changes ─────────────────────────────────────────────────────────────

describe("calculateChanges – no changes", () => {
  it("returns empty array for a freshly loaded document", () => {
    const doc = makeDoc({ _id: "DOC-001", amount: 100 });
    expect(calculateChanges(doc)).toEqual([]);
  });

  it("returns empty array when set is called with the same value", () => {
    const doc = makeDoc({ _id: "DOC-001", amount: 100 });
    // Same value — set() should not dirty the field, so it won't appear in
    // getChangedFields(); even if it did, deepEqual would filter it out.
    doc.set("amount", 100);
    expect(calculateChanges(doc)).toEqual([]);
  });

  it("omits fields that were dirtied but deepEqual finds no difference", () => {
    // Force a dirty entry that still has the same value to test deepEqual filtering
    const doc = makeDoc({ _id: "DOC-001", tags: ["a", "b"] });
    // Manually dirty without actually changing data
    doc._dirty.add("tags");
    // _data["tags"] still equals _original["tags"] by value

    const changes = calculateChanges(doc);
    expect(findChange(changes, "tags")).toBeUndefined();
  });
});

// ─── Array changes ─────────────────────────────────────────────────────────

describe("calculateChanges – array changes", () => {
  it("reports array field when an element is added", () => {
    const doc = makeDoc({ _id: "DOC-001", tags: ["a", "b"] });
    doc.set("tags", ["a", "b", "c"]);

    const changes = calculateChanges(doc);
    const change = findChange(changes, "tags");

    expect(change).toBeDefined();
    expect(change!.old).toEqual(["a", "b"]);
    expect(change!.new).toEqual(["a", "b", "c"]);
  });

  it("reports array field when an element is removed", () => {
    const doc = makeDoc({ _id: "DOC-001", tags: ["a", "b", "c"] });
    doc.set("tags", ["a", "c"]);

    const changes = calculateChanges(doc);
    expect(findChange(changes, "tags")).toBeDefined();
  });

  it("reports array field when element order changes", () => {
    const doc = makeDoc({ _id: "DOC-001", tags: ["a", "b"] });
    doc.set("tags", ["b", "a"]);

    const changes = calculateChanges(doc);
    expect(findChange(changes, "tags")).toBeDefined();
  });

  it("does NOT report array field when contents are identical", () => {
    const doc = makeDoc({ _id: "DOC-001", tags: ["a", "b"] });
    doc._dirty.add("tags");
    // _data["tags"] and _original["tags"] have the same reference from loadFromData
    // Overwrite with equivalent content
    doc._data["tags"] = ["a", "b"];

    const changes = calculateChanges(doc);
    expect(findChange(changes, "tags")).toBeUndefined();
  });
});

// ─── Nested object changes ─────────────────────────────────────────────────

describe("calculateChanges – nested object changes", () => {
  it("reports nested object field when a property changes", () => {
    const doc = makeDoc({ _id: "DOC-001", address: { city: "Berlin", zip: "10115" } });
    doc.set("address", { city: "Munich", zip: "80331" });

    const changes = calculateChanges(doc);
    const change = findChange(changes, "address");

    expect(change).toBeDefined();
    expect((change!.old as Record<string, unknown>)["city"]).toBe("Berlin");
    expect((change!.new as Record<string, unknown>)["city"]).toBe("Munich");
  });

  it("does NOT report nested object field when deeply equal", () => {
    const doc = makeDoc({ _id: "DOC-001", address: { city: "Berlin", zip: "10115" } });
    doc._dirty.add("address");
    doc._data["address"] = { city: "Berlin", zip: "10115" };

    const changes = calculateChanges(doc);
    expect(findChange(changes, "address")).toBeUndefined();
  });

  it("detects added keys in nested objects", () => {
    const doc = makeDoc({ _id: "DOC-001", meta: { source: "web" } });
    doc.set("meta", { source: "web", campaign: "summer" });

    const changes = calculateChanges(doc);
    expect(findChange(changes, "meta")).toBeDefined();
  });

  it("detects removed keys in nested objects", () => {
    const doc = makeDoc({ _id: "DOC-001", meta: { source: "web", campaign: "summer" } });
    doc.set("meta", { source: "web" });

    const changes = calculateChanges(doc);
    expect(findChange(changes, "meta")).toBeDefined();
  });
});

// ─── Date changes ──────────────────────────────────────────────────────────

describe("calculateChanges – date changes", () => {
  it("reports date field when the timestamp differs", () => {
    const oldDate = new Date("2024-01-01T00:00:00Z");
    const newDate = new Date("2024-06-01T00:00:00Z");

    const doc = makeDoc({ _id: "DOC-001", due_date: oldDate });
    doc.set("due_date", newDate);

    const changes = calculateChanges(doc);
    const change = findChange(changes, "due_date");

    expect(change).toBeDefined();
    expect(change!.old).toBe(oldDate);
    expect(change!.new).toBe(newDate);
  });

  it("does NOT report date field when timestamps are equal", () => {
    const date1 = new Date("2024-01-01T00:00:00Z");
    const date2 = new Date("2024-01-01T00:00:00Z");

    const doc = makeDoc({ _id: "DOC-001", due_date: date1 });
    doc._dirty.add("due_date");
    doc._data["due_date"] = date2; // different object, same time

    const changes = calculateChanges(doc);
    expect(findChange(changes, "due_date")).toBeUndefined();
  });
});

// ─── null / undefined handling ─────────────────────────────────────────────

describe("calculateChanges – null and undefined handling", () => {
  it("reports change from a value to null, providing null as new", () => {
    const doc = makeDoc({ _id: "DOC-001", notes: "some text" });
    doc.set("notes", null);

    const changes = calculateChanges(doc);
    const change = findChange(changes, "notes");

    expect(change).toBeDefined();
    expect(change!.old).toBe("some text");
    expect(change!.new).toBeNull();
  });

  it("reports change from null to a value, providing null as old", () => {
    const doc = makeDoc({ _id: "DOC-001", notes: null });
    doc.set("notes", "new text");

    const changes = calculateChanges(doc);
    const change = findChange(changes, "notes");

    expect(change).toBeDefined();
    expect(change!.old).toBeNull();
    expect(change!.new).toBe("new text");
  });

  it("reports change from undefined to a value, providing null as old", () => {
    // Field not in original data → undefined in _original
    const doc = makeDoc({ _id: "DOC-001" });
    doc.set("notes", "appeared");

    const changes = calculateChanges(doc);
    const change = findChange(changes, "notes");

    expect(change).toBeDefined();
    // calculateChanges maps undefined → null via `?? null`
    expect(change!.old).toBeNull();
    expect(change!.new).toBe("appeared");
  });

  it("does NOT report a change when both old and new are null", () => {
    // deepEqual(null, null) → both sides are null; the a===b shortcut catches it
    // but actually: a===null early return is false. Let's check the function:
    // deepEqual(null, null): a===b → true ✓
    const doc = makeDoc({ _id: "DOC-001", notes: null });
    doc._dirty.add("notes");
    doc._data["notes"] = null;

    const changes = calculateChanges(doc);
    // deepEqual(null, null) returns true → no change reported
    expect(findChange(changes, "notes")).toBeUndefined();
  });
});
