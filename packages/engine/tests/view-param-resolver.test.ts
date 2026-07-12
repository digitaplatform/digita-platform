import { describe, it, expect } from "vitest";
import {
  resolveTokens,
  resolveString,
  parseIsoDuration,
  type ResolverContext,
} from "../src/core/view/param-resolver.js";
import type { UserContext } from "../src/core/permissions/types.js";

const user: UserContext = {
  _id: "u1",
  email: "ada@example.com",
  roles: ["System User"],
};

function makeCtx(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    root: { _id: "CUST-1", currency: "EUR", nested: { city: "Berlin" } },
    user,
    params: { since: "P24M", limit: 10 },
    now: new Date("2026-04-28T12:00:00Z"),
    warnings: [],
    ...overrides,
  };
}

describe("resolveString — primitive token forms", () => {
  it("$root.<path>", () => {
    expect(resolveString("$root._id", makeCtx())).toBe("CUST-1");
    expect(resolveString("$root.currency", makeCtx())).toBe("EUR");
    expect(resolveString("$root.nested.city", makeCtx())).toBe("Berlin");
  });

  it("$user.<path>", () => {
    expect(resolveString("$user.email", makeCtx())).toBe("ada@example.com");
  });

  it("$param.<name>", () => {
    expect(resolveString("$param.limit", makeCtx())).toBe(10);
    expect(resolveString("$param.since", makeCtx())).toBe("P24M");
  });

  it("$now", () => {
    const ctx = makeCtx();
    const v = resolveString("$now", ctx);
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).getTime()).toBe(ctx.now.getTime());
  });

  it("$now - PnnM (calendar months)", () => {
    const ctx = makeCtx();
    const v = resolveString("$now - P24M", ctx) as Date;
    expect(v.getUTCFullYear()).toBe(2024);
    expect(v.getUTCMonth()).toBe(3); // April (0-indexed)
  });

  it("$now + P7D", () => {
    const ctx = makeCtx();
    const v = resolveString("$now + P7D", ctx) as Date;
    expect(v.getTime() - ctx.now.getTime()).toBe(7 * 86400_000);
  });

  it("$now - P0M is now", () => {
    const ctx = makeCtx();
    const v = resolveString("$now - P0M", ctx) as Date;
    expect(v.getTime()).toBe(ctx.now.getTime());
  });

  it("$now - $param.<duration>", () => {
    const ctx = makeCtx();
    const v = resolveString("$now - $param.since", ctx) as Date;
    expect(v.getUTCFullYear()).toBe(2024);
  });
});

describe("resolveString — escapes and pass-throughs", () => {
  it("escaped \\$literal yields literal $literal", () => {
    expect(resolveString("\\$keep", makeCtx())).toBe("$keep");
  });

  it("Mongo-style $field references are left untouched", () => {
    expect(resolveString("$lines.product", makeCtx())).toBe("$lines.product");
    expect(resolveString("$first", makeCtx())).toBe("$first");
  });

  it("non-token strings pass through unchanged", () => {
    expect(resolveString("hello", makeCtx())).toBe("hello");
    expect(resolveString("CUST-1", makeCtx())).toBe("CUST-1");
  });
});

describe("resolveString — failure modes attach warnings", () => {
  it("unknown $param emits warning", () => {
    const ctx = makeCtx();
    const v = resolveString("$param.missing", ctx);
    expect(v).toBeNull();
    expect(ctx.warnings).toContain('unknown param "$param.missing"');
  });

  it("$root.<path> in unanchored ctx emits warning", () => {
    const ctx = makeCtx({ root: null });
    expect(resolveString("$root._id", ctx)).toBeNull();
    expect(ctx.warnings.length).toBe(1);
  });

  it("invalid duration emits warning", () => {
    const ctx = makeCtx();
    expect(resolveString("$now - PWAT", ctx)).toBeNull();
    expect(ctx.warnings.length).toBe(1);
  });
});

describe("resolveTokens — deep tree walk", () => {
  it("recursively resolves leaves, preserves structure", () => {
    const ctx = makeCtx();
    const input = {
      $match: { customer: "$root._id", since: "$now - P1M" },
      $unwind: "$lines",
      arr: [{ a: "$param.limit" }, "literal", "$user.email"],
    };
    const out = resolveTokens(input, ctx) as Record<string, unknown>;
    expect((out["$match"] as Record<string, unknown>)["customer"]).toBe("CUST-1");
    expect((out["$match"] as Record<string, unknown>)["since"]).toBeInstanceOf(Date);
    expect(out["$unwind"]).toBe("$lines");
    expect(((out["arr"] as unknown[])[0] as Record<string, unknown>)["a"]).toBe(10);
    expect((out["arr"] as unknown[])[1]).toBe("literal");
    expect((out["arr"] as unknown[])[2]).toBe("ada@example.com");
  });

  it("returns a deep clone — input is untouched", () => {
    const ctx = makeCtx();
    const input = { a: { b: "$root._id" } };
    const out = resolveTokens(input, ctx) as Record<string, Record<string, unknown>>;
    out["a"]!["b"] = "mutated";
    expect((input as { a: { b: string } }).a.b).toBe("$root._id");
  });
});

describe("parseIsoDuration", () => {
  it("parses combined components", () => {
    expect(parseIsoDuration("P1Y2M3D")).toEqual({
      years: 1, months: 2, weeks: 0, days: 3, hours: 0, minutes: 0, seconds: 0,
    });
    expect(parseIsoDuration("PT4H30M")).toEqual({
      years: 0, months: 0, weeks: 0, days: 0, hours: 4, minutes: 30, seconds: 0,
    });
  });

  it("rejects malformed input", () => {
    expect(parseIsoDuration("P")).toBeNull();
    expect(parseIsoDuration("24M")).toBeNull();
    expect(parseIsoDuration("PT")).toBeNull();
  });
});
