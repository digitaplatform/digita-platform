import { describe, it, expect } from "vitest";
import {
  buildMongoFilter,
  buildSort,
  parsePagination,
} from "../src/core/database/filter-builder.js";

// ─── buildMongoFilter ─────────────────────────────────────

describe("buildMongoFilter", () => {
  it("returns empty filter for empty query", () => {
    expect(buildMongoFilter({})).toEqual({});
  });

  it("returns empty filter when filters array is empty", () => {
    expect(buildMongoFilter({ filters: [] })).toEqual({});
  });

  describe("AND filters — all operators", () => {
    it("= (equality)", () => {
      const result = buildMongoFilter({ filters: [["status", "=", "active"]] });
      expect(result).toEqual({ status: "active" });
    });

    it("== (equality alias)", () => {
      const result = buildMongoFilter({ filters: [["status", "==", "active"]] });
      expect(result).toEqual({ status: "active" });
    });

    it("!= (not equal)", () => {
      const result = buildMongoFilter({ filters: [["status", "!=", "inactive"]] });
      expect(result).toEqual({ status: { $ne: "inactive" } });
    });

    it("<> (not equal alias)", () => {
      const result = buildMongoFilter({ filters: [["status", "<>", "inactive"]] });
      expect(result).toEqual({ status: { $ne: "inactive" } });
    });

    it("> (greater than)", () => {
      const result = buildMongoFilter({ filters: [["age", ">", 18]] });
      expect(result).toEqual({ age: { $gt: 18 } });
    });

    it(">= (greater than or equal)", () => {
      const result = buildMongoFilter({ filters: [["age", ">=", 18]] });
      expect(result).toEqual({ age: { $gte: 18 } });
    });

    it("< (less than)", () => {
      const result = buildMongoFilter({ filters: [["price", "<", 100]] });
      expect(result).toEqual({ price: { $lt: 100 } });
    });

    it("<= (less than or equal)", () => {
      const result = buildMongoFilter({ filters: [["price", "<=", 100]] });
      expect(result).toEqual({ price: { $lte: 100 } });
    });

    it("in", () => {
      const result = buildMongoFilter({ filters: [["status", "in", ["a", "b"]]] });
      expect(result).toEqual({ status: { $in: ["a", "b"] } });
    });

    it("not in", () => {
      const result = buildMongoFilter({ filters: [["status", "not in", ["x", "y"]]] });
      expect(result).toEqual({ status: { $nin: ["x", "y"] } });
    });

    it("like — converts % to .* and _ to .", () => {
      const result = buildMongoFilter({ filters: [["name", "like", "%john_"]] });
      const mongo = result as Record<string, unknown>;
      const nameFilter = mongo["name"] as { $regex: string; $options: string };
      expect(nameFilter.$options).toBe("i");
      expect(nameFilter.$regex).toMatch(/\.\*john\./);
    });

    it("not like", () => {
      const result = buildMongoFilter({ filters: [["name", "not like", "%test%"]] });
      const mongo = result as Record<string, unknown>;
      const nameFilter = mongo["name"] as { $not: { $regex: string; $options: string } };
      expect(nameFilter.$not).toBeDefined();
      expect(nameFilter.$not.$options).toBe("i");
    });

    it("between — maps to $gte/$lte", () => {
      const result = buildMongoFilter({ filters: [["age", "between", [18, 65]]] });
      expect(result).toEqual({ age: { $gte: 18, $lte: 65 } });
    });

    it("is set — maps to $ne: null", () => {
      const result = buildMongoFilter({ filters: [["email", "is", "set"]] });
      expect(result).toEqual({ email: { $ne: null } });
    });

    it("is not null — maps to $ne: null", () => {
      const result = buildMongoFilter({ filters: [["email", "is", "not null"]] });
      expect(result).toEqual({ email: { $ne: null } });
    });

    it("is not set — maps to null", () => {
      const result = buildMongoFilter({ filters: [["email", "is", "not set"]] });
      expect(result).toEqual({ email: null });
    });

    it("is null — maps to null", () => {
      const result = buildMongoFilter({ filters: [["email", "is", "null"]] });
      expect(result).toEqual({ email: null });
    });

    it("regex", () => {
      const result = buildMongoFilter({ filters: [["name", "regex", "^John"]] });
      expect(result).toEqual({ name: { $regex: "^John", $options: "i" } });
    });

    it("exists", () => {
      const result = buildMongoFilter({ filters: [["field", "exists", true]] });
      expect(result).toEqual({ field: { $exists: true } });
    });

    it("multiple AND filters are combined with $and", () => {
      const result = buildMongoFilter({
        filters: [
          ["status", "=", "active"],
          ["age", ">=", 18],
        ],
      });
      expect(result).toEqual({
        $and: [{ status: "active" }, { age: { $gte: 18 } }],
      });
    });
  });

  describe("OR filters", () => {
    it("single or_filter is wrapped in $or", () => {
      const result = buildMongoFilter({
        or_filters: [["status", "=", "active"]],
      });
      expect(result).toEqual({ $or: [{ status: "active" }] });
    });

    it("multiple or_filters produce a single $or clause", () => {
      const result = buildMongoFilter({
        or_filters: [
          ["status", "=", "active"],
          ["role", "=", "admin"],
        ],
      });
      expect(result).toEqual({
        $or: [{ status: "active" }, { role: "admin" }],
      });
    });
  });

  describe("text search", () => {
    it("search with searchFields produces $or of regex conditions", () => {
      const result = buildMongoFilter({ search: "hello" }, ["name", "email"]);
      expect(result).toEqual({
        $or: [
          { name: { $regex: "hello", $options: "i" } },
          { email: { $regex: "hello", $options: "i" } },
        ],
      });
    });

    it("search without searchFields is ignored", () => {
      const result = buildMongoFilter({ search: "hello" });
      expect(result).toEqual({});
    });

    it("escapes special regex characters in the search string", () => {
      const result = buildMongoFilter({ search: "a.b+c" }, ["name"]);
      const mongo = result as { $or: Array<{ name: { $regex: string } }> };
      expect(mongo.$or[0]!.name.$regex).toBe("a\\.b\\+c");
    });
  });

  describe("combined AND + OR + search", () => {
    it("combines all three as a top-level $and", () => {
      const result = buildMongoFilter(
        {
          filters: [["status", "=", "active"]],
          or_filters: [["role", "=", "admin"]],
          search: "john",
        },
        ["name"],
      );
      expect(result).toEqual({
        $and: [
          { status: "active" },
          { $or: [{ role: "admin" }] },
          { $or: [{ name: { $regex: "john", $options: "i" } }] },
        ],
      });
    });
  });
});

// ─── like pattern conversion ──────────────────────────────

describe("like pattern conversion", () => {
  it("% at start becomes .*", () => {
    const result = buildMongoFilter({ filters: [["name", "like", "%foo"]] });
    const mongo = result as Record<string, { $regex: string }>;
    expect(mongo["name"]!.$regex).toBe(".*foo");
  });

  it("% at end becomes .*", () => {
    const result = buildMongoFilter({ filters: [["name", "like", "foo%"]] });
    const mongo = result as Record<string, { $regex: string }>;
    expect(mongo["name"]!.$regex).toBe("foo.*");
  });

  it("_ becomes single dot wildcard", () => {
    const result = buildMongoFilter({ filters: [["code", "like", "A_1"]] });
    const mongo = result as Record<string, { $regex: string }>;
    expect(mongo["code"]!.$regex).toBe("A.1");
  });

  it("mixed % and _ pattern", () => {
    const result = buildMongoFilter({ filters: [["name", "like", "%jo_n%"]] });
    const mongo = result as Record<string, { $regex: string }>;
    expect(mongo["name"]!.$regex).toBe(".*jo.n.*");
  });
});

// ─── buildSort ────────────────────────────────────────────

describe("buildSort", () => {
  it("returns undefined for undefined input", () => {
    expect(buildSort(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(buildSort("")).toBeUndefined();
  });

  it("single field defaults to ascending", () => {
    expect(buildSort("name")).toEqual({ name: 1 });
  });

  it("single field with asc keyword", () => {
    expect(buildSort("name asc")).toEqual({ name: 1 });
  });

  it("single field with desc keyword", () => {
    expect(buildSort("name desc")).toEqual({ name: -1 });
  });

  it("multiple comma-separated fields", () => {
    expect(buildSort("name asc, age desc")).toEqual({ name: 1, age: -1 });
  });

  it("multiple fields with mixed directions", () => {
    expect(buildSort("created_at desc, title asc, idx")).toEqual({
      created_at: -1,
      title: 1,
      idx: 1,
    });
  });
});

// ─── parsePagination ──────────────────────────────────────

describe("parsePagination", () => {
  it("defaults to limit=20, offset=0 when nothing is provided", () => {
    expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
  });

  it("uses limit/offset when explicitly provided", () => {
    expect(parsePagination({ limit: 50, offset: 10 })).toEqual({ limit: 50, offset: 10 });
  });

  it("page/page_size mode — page 1", () => {
    expect(parsePagination({ page: 1, page_size: 25 })).toEqual({ limit: 25, offset: 0 });
  });

  it("page/page_size mode — page 2", () => {
    expect(parsePagination({ page: 2, page_size: 25 })).toEqual({ limit: 25, offset: 25 });
  });

  it("page/page_size mode — page 3", () => {
    expect(parsePagination({ page: 3, page_size: 10 })).toEqual({ limit: 10, offset: 20 });
  });

  it("page/page_size takes priority over limit/offset when both present", () => {
    // When page and page_size are defined, they win
    expect(parsePagination({ page: 2, page_size: 5, limit: 100, offset: 0 })).toEqual({
      limit: 5,
      offset: 5,
    });
  });

  it("uses default offset=0 when only limit provided", () => {
    expect(parsePagination({ limit: 30 })).toEqual({ limit: 30, offset: 0 });
  });

  it("uses default limit=20 when only offset provided", () => {
    expect(parsePagination({ offset: 5 })).toEqual({ limit: 20, offset: 5 });
  });
});
