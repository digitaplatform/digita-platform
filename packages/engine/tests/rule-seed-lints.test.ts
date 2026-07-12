// F3: fail-loud seed lints — a rule authored against an undispatchable event, a
// set_value at a post-write event, a missing target, an undeclared mapping key,
// an update_document key outside the allow_on_submit band, or a $param token is
// rejected at seed time (findRuleLintError / findUnparsableRuleExpression).
import { vi, describe, it, expect } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import {
  findRuleLintError,
  findUnparsableRuleExpression,
} from "../src/core/rules/rule-loader.js";
import type { RuleDefinition, RuleAction } from "../src/core/rules/rule-types.js";

const registry = {
  has: (n: string) => n === "Invoice" || n === "FollowUp",
  get: (n: string) => {
    if (n === "Invoice") {
      return {
        fields: [
          { fieldname: "status", allow_on_submit: true },
          { fieldname: "note" },
          { fieldname: "total" },
        ],
      };
    }
    return { fields: [{ fieldname: "subject" }, { fieldname: "due_date" }] };
  },
} as never;

function rule(event: string, ...actions: RuleAction[]): RuleDefinition {
  return { _id: "r", label: "r", entity: "X", event, actions };
}

describe("findRuleLintError — boot-fail cases", () => {
  it("(a) rejects an undispatchable event", () => {
    const e = findRuleLintError(rule("before_delete", { type: "validate", condition: "doc.x" }), registry);
    expect(e).toMatch(/never dispatched/);
  });

  it("(b) rejects set_value at a post-write event", () => {
    const e = findRuleLintError(rule("on_submit", { type: "set_value", field: "x", value: "'y'" }), registry);
    expect(e).toMatch(/set_value is only allowed/);
  });

  it("(c) rejects an unknown target_entity", () => {
    const e = findRuleLintError(
      rule("on_submit", { type: "create_document", target_entity: "Nope", field_mappings: { subject: "'x'" } }),
      registry,
    );
    expect(e).toMatch(/does not exist/);
  });

  it("(d) rejects an undeclared mapping key", () => {
    const e = findRuleLintError(
      rule("on_submit", {
        type: "create_document",
        target_entity: "FollowUp",
        field_mappings: { nonexistent: "'x'" },
      }),
      registry,
    );
    expect(e).toMatch(/not a declared field/);
  });

  it("(e) rejects an update_document key outside the allow_on_submit band", () => {
    const e = findRuleLintError(
      rule("on_submit", {
        type: "update_document",
        target_entity: "Invoice",
        target_name: "'INV-1'",
        field_mappings: { note: "'x'" },
      }),
      registry,
    );
    expect(e).toMatch(/not allow_on_submit/);
  });

  it("(e2) rejects update_document without target_name", () => {
    const e = findRuleLintError(
      rule("on_submit", {
        type: "update_document",
        target_entity: "Invoice",
        field_mappings: { status: "'paid'" },
      }),
      registry,
    );
    expect(e).toMatch(/requires target_name/);
  });

  it("rejects a removed/unknown action type", () => {
    const e = findRuleLintError(
      rule("on_submit", { type: "update_self" as never, field_mappings: {} }),
      registry,
    );
    expect(e).toMatch(/unknown action type/);
  });
});

describe("findRuleLintError — accepted cases", () => {
  it("accepts a workflow-transition pattern event", () => {
    expect(
      findRuleLintError(
        rule("on_workflow_transition:Draft:Approved", { type: "validate", condition: "doc.x" }),
        registry,
      ),
    ).toBeNull();
  });

  it("accepts a governed create_document", () => {
    expect(
      findRuleLintError(
        rule("on_submit", {
          type: "create_document",
          target_entity: "FollowUp",
          field_mappings: { subject: "'hi'" },
        }),
        registry,
      ),
    ).toBeNull();
  });

  it("accepts an update_document over an allow_on_submit field", () => {
    expect(
      findRuleLintError(
        rule("on_submit", {
          type: "update_document",
          target_entity: "Invoice",
          target_name: "'INV-1'",
          field_mappings: { status: "'paid'" },
        }),
        registry,
      ),
    ).toBeNull();
  });

  it("accepts set_value at a pre-write event", () => {
    expect(
      findRuleLintError(rule("validate", { type: "set_value", field: "x", value: "'y'" }), registry),
    ).toBeNull();
  });
});

describe("findUnparsableRuleExpression — (f) $param token rejected", () => {
  it("rejects a $param token in a value slot", () => {
    expect(
      findUnparsableRuleExpression(
        rule("on_submit", {
          type: "create_document",
          target_entity: "FollowUp",
          field_mappings: { subject: "$param.x" },
        }),
      ),
    ).toBeTruthy();
  });
});
