import { describe, it, expect } from "vitest";
import { buildMongoFilter, FilterFieldNotAllowedError } from "../src/core/database/filter-builder.js";

const allowed = new Set(["title", "status", "amount", "_id", "items"]);

describe("buildMongoFilter allow-list (P-SEC/R7 — NoSQL operator injection)", () => {
  it("allows a declared field", () => {
    const f = buildMongoFilter({ filters: [["title", "=", "x"]] }, [], allowed);
    expect(Object.keys(f)).toContain("title");
  });

  it("allows a declared dotted child path (root segment allow-listed)", () => {
    expect(() => buildMongoFilter({ filters: [["items.qty", ">", 1]] }, [], allowed)).not.toThrow();
  });

  it("rejects a $-prefixed operator key in the field position ($where)", () => {
    expect(() => buildMongoFilter({ filters: [["$where", "=", "sleep(1)"]] }, [], allowed)).toThrow(
      FilterFieldNotAllowedError,
    );
  });

  it("rejects $expr injection", () => {
    expect(() => buildMongoFilter({ filters: [["$expr", "=", {}]] }, [], allowed)).toThrow(
      FilterFieldNotAllowedError,
    );
  });

  it("rejects an undeclared field name", () => {
    expect(() => buildMongoFilter({ filters: [["password", "=", "x"]] }, [], allowed)).toThrow(/password/);
  });

  it("rejects an injected or_filter field too", () => {
    expect(() => buildMongoFilter({ or_filters: [["$where", "=", "x"]] }, [], allowed)).toThrow(
      FilterFieldNotAllowedError,
    );
  });

  it("no allow-list ⇒ legacy unrestricted behaviour (back-compat for internal callers)", () => {
    expect(() => buildMongoFilter({ filters: [["anything", "=", "x"]] })).not.toThrow();
  });
});
