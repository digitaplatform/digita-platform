import { describe, it, expect } from "vitest";
import { validateViewDefinition } from "../src/core/view/view-validator.js";

const VALID: unknown = {
  _id: "v1",
  name: "Test",
  source: { entity: "customer", param: "id" },
  params: [{ name: "id", type: "string", required: true }],
  sections: [
    {
      key: "country",
      kind: "link",
      entity: "country",
      target: "$root.vat_id_country",
    },
  ],
};

describe("validateViewDefinition — happy path", () => {
  it("accepts a minimal valid view", () => {
    expect(validateViewDefinition(VALID)).toEqual([]);
  });
});

describe("validateViewDefinition — required fields", () => {
  it("rejects missing _id", () => {
    const v = { ...(VALID as Record<string, unknown>), _id: "" };
    expect(validateViewDefinition(v).length).toBeGreaterThan(0);
  });

  it("rejects missing source on anchored view", () => {
    const v = { ...(VALID as Record<string, unknown>) } as Record<string, unknown>;
    delete v["source"];
    const errs = validateViewDefinition(v);
    expect(errs.some((e) => e.message.includes("source"))).toBe(true);
  });

  it("rejects empty sections array", () => {
    const v = { ...(VALID as Record<string, unknown>), sections: [] };
    expect(validateViewDefinition(v)[0]?.message).toContain("non-empty");
  });
});

describe("validateViewDefinition — kind-specific", () => {
  it("rejects link section without target", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [{ key: "x", kind: "link", entity: "country" }],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("target"))).toBe(true);
  });

  it("rejects list section with invalid filter op", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "list",
          entity: "customerAddress",
          filter: [["customer", "BOGUS", "$root._id"]],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("op invalid"))).toBe(true);
  });

  it("rejects aggregate with forbidden operator $where", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "aggregate",
          entity: "salesInvoice",
          pipeline: [{ $match: { $where: "function() { return true }" } }],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("$where"))).toBe(true);
  });

  it("rejects aggregate stage outside whitelist", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "aggregate",
          entity: "salesInvoice",
          pipeline: [{ $out: "leaks" }],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("$out"))).toBe(true);
  });

  it("rejects $unionWith smuggled inside a nested $facet → $lookup sub-pipeline", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "aggregate",
          entity: "salesInvoice",
          pipeline: [
            {
              $facet: {
                branch: [
                  {
                    $lookup: {
                      from: "country",
                      as: "c",
                      pipeline: [{ $unionWith: { coll: "secrets" } }],
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    // Two levels deep — the old one-level check never re-validated the nested
    // $lookup.pipeline, so $unionWith escaped.
    expect(validateViewDefinition(v).some((e) => e.message.includes("$unionWith"))).toBe(true);
  });

  it("rejects aggregate stage with multiple operators", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "aggregate",
          entity: "salesInvoice",
          pipeline: [{ $match: {}, $unwind: "$lines" }],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("exactly one"))).toBe(true);
  });
});

describe("validateViewDefinition — params + tokens", () => {
  it("rejects a section that references an undeclared param", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "list",
          entity: "salesInvoice",
          filter: [["invoice_date", ">=", "$now - $param.since"]],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("$param.since"))).toBe(true);
  });

  it("rejects $root.* in unanchored view", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      anchored: false,
      source: undefined,
      sections: [
        {
          key: "x",
          kind: "list",
          entity: "salesInvoice",
          filter: [["customer", "=", "$root._id"]],
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("unanchored"))).toBe(true);
  });

  it("rejects malformed reserved token", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "link",
          entity: "country",
          target: "$root.",
        },
      ],
    };
    expect(validateViewDefinition(v).some((e) => e.message.includes("malformed"))).toBe(true);
  });

  it("allows Mongo-style $field references through (does not flag)", () => {
    const v = {
      ...(VALID as Record<string, unknown>),
      sections: [
        {
          key: "x",
          kind: "aggregate",
          entity: "salesInvoice",
          pipeline: [
            { $unwind: "$lines" },
            { $group: { _id: "$lines.product", total: { $sum: "$lines.line_total" } } },
          ],
        },
      ],
    };
    expect(validateViewDefinition(v)).toEqual([]);
  });
});
