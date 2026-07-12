import { describe, it, expect, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import type { EntityDefinition } from "@digitaplatform/shared";
import { SYSTEM_ROLES } from "@digitaplatform/shared";
import {
  WorkflowEngine,
  IllegalTransitionError,
  AmbiguousDocStatusStateError,
} from "../src/core/workflow/workflow-engine.js";

const expenseEntity = (): EntityDefinition => ({
  name: "Expense",
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [
    { fieldname: "status", fieldtype: "Select", label: "Status", options: ["Draft", "Approved", "Rejected", "Cancelled"] },
    { fieldname: "amount", fieldtype: "Currency", label: "Amount" },
  ],
  permissions: [],
  states: [
    { value: "Draft", color: "gray", is_initial: true },
    { value: "Approved", color: "green", is_terminal: true },
    { value: "Rejected", color: "red" },
    { value: "Cancelled", color: "red" },
  ],
  transitions: [
    { from: "Draft", to: "Approved", action: "approve", allowed_roles: ["Manager"] },
    { from: "Draft", to: "Rejected", action: "reject", allowed_roles: ["Manager"], condition: "doc.amount > 0" },
    { from: "*", to: "Cancelled", action: "cancel", allowed_roles: ["Salesperson", "Manager"] },
  ],
} as unknown as EntityDefinition);

const registry = {
  get: () => expenseEntity(),
  has: (n: string) => n === "Expense",
} as never;

const manager = { _id: "m", email: "m@x", roles: ["Manager"] };
const sales = { _id: "s", email: "s@x", roles: ["Salesperson"] };
const admin = { _id: "a", email: "a@x", roles: [SYSTEM_ROLES.ADMINISTRATOR] };

describe("WorkflowEngine — initial state", () => {
  it("getInitialState returns the is_initial state", () => {
    const w = new WorkflowEngine(registry);
    expect(w.getInitialState(expenseEntity())).toBe("Draft");
  });

  it("getInitialState returns undefined when no is_initial declared", () => {
    const w = new WorkflowEngine(registry);
    const e = expenseEntity();
    e.states = e.states!.map((s) => ({ ...s, is_initial: false }));
    expect(w.getInitialState(e)).toBeUndefined();
  });
});

describe("WorkflowEngine — validateTransition", () => {
  it("allows a declared transition for an authorised user", () => {
    const w = new WorkflowEngine(registry);
    expect(() =>
      w.validateTransition(expenseEntity(), { amount: 100 }, "Draft", "Approved", manager as never),
    ).not.toThrow();
  });

  it("rejects a transition for a user without an allowed role", () => {
    const w = new WorkflowEngine(registry);
    expect(() =>
      w.validateTransition(expenseEntity(), { amount: 100 }, "Draft", "Approved", sales as never),
    ).toThrow(IllegalTransitionError);
  });

  it("rejects an undeclared transition (Approved → Draft)", () => {
    const w = new WorkflowEngine(registry);
    // Approved is_terminal AND no declared Approved→Draft transition → from_terminal.
    expect(() =>
      w.validateTransition(expenseEntity(), {}, "Approved", "Draft", manager as never),
    ).toThrow(IllegalTransitionError);
  });

  it("allows a DECLARED transition out of a terminal state (Reopen)", () => {
    const e = expenseEntity();
    e.transitions!.push({ from: "Approved", to: "Draft", action: "reopen", allowed_roles: ["Manager"] });
    const w = new WorkflowEngine(registry);
    const t = w.validateTransition(e, {}, "Approved", "Draft", manager as never);
    expect(t?.action).toBe("reopen");
  });

  it("rejects when condition fails", () => {
    const w = new WorkflowEngine(registry);
    expect(() =>
      w.validateTransition(expenseEntity(), { amount: 0 }, "Draft", "Rejected", manager as never),
    ).toThrow(IllegalTransitionError);
  });

  it("wildcard from: '*' transitions match any prior state", () => {
    const w = new WorkflowEngine(registry);
    expect(() =>
      w.validateTransition(expenseEntity(), {}, "Rejected", "Cancelled", sales as never),
    ).not.toThrow();
  });

  it("Administrator bypasses role/condition gates", () => {
    const w = new WorkflowEngine(registry);
    expect(() =>
      w.validateTransition(expenseEntity(), { amount: 0 }, "Draft", "Rejected", admin as never),
    ).not.toThrow();
  });
});

describe("WorkflowEngine — applyTransition + side_effects", () => {
  it("RETURNS side_effects.set as a map and does NOT mutate the passed doc", async () => {
    // Return-based contract: applyTransition must not pre-mutate the record,
    // else the caller's doc.merge() would see old===new and drop the field
    // (the latent dirty-tracking bug this fixes).
    const e = expenseEntity();
    e.transitions![0]!.side_effects = { set: { approved_at: "2026-04-29", approved_by: "m@x" } };
    const w = new WorkflowEngine(registry);
    const doc: Record<string, unknown> = { amount: 100 };
    const result = await w.applyTransition(
      e,
      doc,
      e.transitions![0]!,
      "Draft",
      "Approved",
      manager as never,
      undefined as never,
    );
    expect(result).toEqual({ approved_at: "2026-04-29", approved_by: "m@x" });
    expect(doc["approved_at"]).toBeUndefined();
    expect(doc["approved_by"]).toBeUndefined();
  });

  it("returns ONLY the authorizing transition's side_effects, not a forbidden sibling's", async () => {
    // Two transitions share (Draft, Approved): the Manager-allowed one and a
    // CFO-only one. A Manager must trigger only the first's side effects.
    const e = expenseEntity();
    e.transitions = [
      { from: "Draft", to: "Approved", action: "approve", allowed_roles: ["Manager"], side_effects: { set: { approved_by: "m@x" } } },
      { from: "Draft", to: "Approved", action: "cfo_sign", allowed_roles: ["CFO"], side_effects: { set: { cfo_signed: true } } },
    ] as unknown as EntityDefinition["transitions"];
    const w = new WorkflowEngine(registry);
    const doc: Record<string, unknown> = { amount: 100 };
    const t = w.validateTransition(e, doc, "Draft", "Approved", manager as never);
    const result = await w.applyTransition(e, doc, t, "Draft", "Approved", manager as never, undefined as never);
    expect(result).toEqual({ approved_by: "m@x" });
    expect(result["cfo_signed"]).toBeUndefined();
  });

  it("fires on_workflow_transition rule event", async () => {
    const ruleEngine = { execute: vi.fn().mockResolvedValue({}) };
    const w = new WorkflowEngine(registry, ruleEngine as never);
    await w.applyTransition(
      expenseEntity(),
      { amount: 100 },
      undefined as never,
      "Draft",
      "Approved",
      manager as never,
      undefined as never,
    );
    expect(ruleEngine.execute).toHaveBeenCalledWith(
      "Expense",
      "on_workflow_transition:Draft:Approved",
      expect.any(Object),
      manager,
      undefined,
    );
  });
});

describe("WorkflowEngine — resolveStateOverride", () => {
  it("returns the per-role override for the doc's current state", () => {
    const e = expenseEntity();
    e.states![0] = { ...e.states![0]!, permissions: [{ role: "Salesperson", write: 0 }] } as never;
    const w = new WorkflowEngine(registry);
    const override = w.resolveStateOverride(e, { status: "Draft" }, "Salesperson");
    expect(override?.write).toBe(0);
  });

  it("returns null when state has no override for the role", () => {
    const w = new WorkflowEngine(registry);
    const override = w.resolveStateOverride(expenseEntity(), { status: "Draft" }, "Salesperson");
    expect(override).toBeNull();
  });
});

describe("WorkflowEngine — validateDefinition (boot warnings)", () => {
  it("flags multiple is_initial states", () => {
    const e = expenseEntity();
    e.states![1] = { ...e.states![1]!, is_initial: true } as never;
    const w = new WorkflowEngine(registry);
    const warnings = w.validateDefinition(e);
    expect(warnings.some((s) => s.includes("multiple is_initial"))).toBe(true);
  });

  it("flags transition.to referencing unknown state", () => {
    const e = expenseEntity();
    e.transitions!.push({ from: "Draft", to: "Phantom", allowed_roles: ["Manager"] });
    const w = new WorkflowEngine(registry);
    const warnings = w.validateDefinition(e);
    expect(warnings.some((s) => s.includes('"Phantom"'))).toBe(true);
  });

  it("does NOT flag a DECLARED transition out of a terminal state (Reopen is permitted)", () => {
    const e = expenseEntity();
    e.transitions!.push({ from: "Approved", to: "Draft", allowed_roles: ["Manager"] });
    const w = new WorkflowEngine(registry);
    const warnings = w.validateDefinition(e);
    expect(warnings.some((s) => s.includes("terminal state"))).toBe(false);
  });
});

describe("WorkflowEngine — getStateForDocStatus (B6: explicit declaration, no order guessing)", () => {
  const w = new WorkflowEngine(registry);
  const mk = (states: unknown[]): EntityDefinition =>
    ({
      name: "W",
      module: "test",
      database: "app",
      naming: { strategy: "user_set" },
      fields: [],
      permissions: [],
      states,
      transitions: [{ from: "*", to: "x", allowed_roles: [] }],
    }) as unknown as EntityDefinition;

  it("returns the single state matching a doc_status", () => {
    const e = mk([{ value: "posted", color: "g", doc_status: 1 }]);
    expect(w.getStateForDocStatus(e, 1)).toBe("posted");
  });

  it("prefers the single NON-terminal candidate (submit lands in the entry state)", () => {
    const e = mk([
      { value: "posted", color: "g", doc_status: 1 },
      { value: "paid", color: "b", doc_status: 1, is_terminal: true },
    ]);
    expect(w.getStateForDocStatus(e, 1)).toBe("posted");
  });

  it("honors docstatus_default even among terminal siblings (cancel → cancelled)", () => {
    const e = mk([
      { value: "expired", color: "g", doc_status: 2, is_terminal: true },
      { value: "cancelled", color: "r", doc_status: 2, is_terminal: true, docstatus_default: true },
    ]);
    expect(w.getStateForDocStatus(e, 2)).toBe("cancelled");
  });

  it("throws (no_default) when multiple non-terminal candidates and no flag", () => {
    const e = mk([
      { value: "active", color: "g", doc_status: 1 },
      { value: "paused", color: "y", doc_status: 1 },
    ]);
    expect(() => w.getStateForDocStatus(e, 1)).toThrow(AmbiguousDocStatusStateError);
  });

  it("throws (no_default) when all candidates are terminal and none flagged", () => {
    const e = mk([
      { value: "rejected", color: "r", doc_status: 2, is_terminal: true },
      { value: "expired", color: "g", doc_status: 2, is_terminal: true },
    ]);
    expect(() => w.getStateForDocStatus(e, 2)).toThrow(AmbiguousDocStatusStateError);
  });

  it("throws (multiple_default) when more than one candidate is flagged", () => {
    const e = mk([
      { value: "a", color: "g", doc_status: 1, docstatus_default: true },
      { value: "b", color: "g", doc_status: 1, docstatus_default: true },
    ]);
    expect(() => w.getStateForDocStatus(e, 1)).toThrow(AmbiguousDocStatusStateError);
  });

  it("returns undefined when no state matches the doc_status", () => {
    const e = mk([{ value: "draft", color: "g", doc_status: 0 }]);
    expect(w.getStateForDocStatus(e, 1)).toBeUndefined();
  });
});
