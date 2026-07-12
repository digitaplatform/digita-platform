// C3 fail-loud guard: an unparsable rule expression (e.g. an unsupported `$`
// token) used to be seeded silently and then throw at runtime inside the
// triggering document's transaction on every submit. The seed guard rejects
// such rules at boot instead.
import { vi, describe, it, expect } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import {
  assertExpressionParsable,
  assertConditionParsable,
} from "../src/core/rules/rule-expression.js";
import { findUnparsableRuleExpression } from "../src/core/rules/rule-loader.js";
import type { RuleDefinition } from "../src/core/rules/rule-types.js";

describe("rule seed guard (C3, slot-aware)", () => {
  it("accepts $-tokens in a VALUE slot (field_mappings value)", () => {
    // Tokens are value-position sugar — legal where a value is written.
    expect(() => assertExpressionParsable("$now")).not.toThrow();
    expect(() => assertExpressionParsable("$now + P14D")).not.toThrow();
    expect(() => assertExpressionParsable("$root.warehouse")).not.toThrow();
    expect(() => assertExpressionParsable("$user.email")).not.toThrow();
  });

  it("rejects $-tokens in a CONDITION slot", () => {
    expect(() => assertConditionParsable("$now")).toThrow();
    expect(() => assertConditionParsable("$root.warehouse")).toThrow();
  });

  it("rejects malformed tokens and $param in any slot", () => {
    expect(() => assertExpressionParsable("$now + PXX")).toThrow();
    expect(() => assertExpressionParsable("$root.")).toThrow();
    expect(() => assertExpressionParsable("$param.x")).toThrow();
  });

  it("assertExpressionParsable accepts supported rule syntax", () => {
    expect(() => assertExpressionParsable("now")).not.toThrow();
    expect(() => assertExpressionParsable("doc.warehouse")).not.toThrow();
    expect(() => assertExpressionParsable("'Stocktake adjustment ' + doc.stocktake_no")).not.toThrow();
    expect(() => assertExpressionParsable("row.delta != 0")).not.toThrow();
  });

  it("flags a $-token used in a CONDITION slot as unparsable", () => {
    const broken: RuleDefinition = {
      _id: "x",
      label: "x",
      entity: "Stocktake",
      event: "on_submit",
      actions: [
        {
          type: "create_document",
          target_entity: "StockMovement",
          iterate: "doc.lines",
          // $now in a per-row condition is illegal (condition slot).
          condition: "$now",
          field_mappings: { posted_at: "now", warehouse: "doc.warehouse" },
        },
      ],
    };
    expect(findUnparsableRuleExpression(broken)).toBeTruthy();
  });

  it("accepts $-tokens in field_mappings values (value slot)", () => {
    const withTokens: RuleDefinition = {
      _id: "x",
      label: "x",
      entity: "Stocktake",
      event: "on_submit",
      actions: [
        {
          type: "create_document",
          target_entity: "StockMovement",
          iterate: "doc.lines",
          condition: "row.delta != 0",
          field_mappings: { posted_at: "$now", warehouse: "$root.warehouse" },
        },
      ],
    };
    expect(findUnparsableRuleExpression(withTokens)).toBeNull();
  });

  it("passes the fixed stocktake rule", () => {
    const fixed: RuleDefinition = {
      _id: "x",
      label: "x",
      entity: "Stocktake",
      event: "on_submit",
      actions: [
        {
          type: "create_document",
          target_entity: "StockMovement",
          iterate: "doc.lines",
          condition: "row.delta != 0",
          field_mappings: {
            posted_at: "now",
            warehouse: "doc.warehouse",
            narration: "'Stocktake adjustment ' + doc.stocktake_no",
          },
        },
      ],
    };
    expect(findUnparsableRuleExpression(fixed)).toBeNull();
  });
});
