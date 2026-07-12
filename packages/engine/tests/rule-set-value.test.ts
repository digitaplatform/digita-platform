// P2: set_value is an IN-MEMORY mutation (no db write) that flows through the
// pipeline at pre-write events, and is rejected (fail loud) anywhere else.
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

const loadActiveRulesMock = vi.fn();
vi.mock("../src/core/rules/rule-loader.js", () => ({
  loadActiveRules: (...args: unknown[]) => loadActiveRulesMock(...args),
}));

import { RuleEngine } from "../src/core/rules/rule-engine.js";
import { executeSetValue } from "../src/core/rules/actions/set-value.js";
import type { RuleExecContext } from "../src/core/rules/rule-types.js";

const user = { _id: "u", email: "u@x", roles: [] } as never;

// db stub whose every write THROWS — proves set_value never persists via db.
function throwingDb() {
  return {
    updateOne: vi.fn(() => {
      throw new Error("db write should never happen for set_value");
    }),
    insertOne: vi.fn(() => {
      throw new Error("db write should never happen for set_value");
    }),
  } as never;
}
const registry = { get: () => ({ database: "app" }) } as never;

describe("executeSetValue (in-memory mutation)", () => {
  it("mutates exec.doc AND exec.mutations, touches no db", () => {
    const exec: RuleExecContext = { doc: { qty: 5 }, mutations: {}, now: new Date() };
    executeSetValue({ type: "set_value", field: "note", value: "'hi ' + doc.qty" }, exec);
    expect((exec.doc as Record<string, unknown>).note).toBe("hi 5");
    expect(exec.mutations.note).toBe("hi 5");
  });

  it("requires field and value", () => {
    const exec: RuleExecContext = { doc: {}, mutations: {}, now: new Date() };
    expect(() => executeSetValue({ type: "set_value", value: "'x'" }, exec)).toThrow(/field/);
    expect(() => executeSetValue({ type: "set_value", field: "f" }, exec)).toThrow(/value/);
  });
});

describe("RuleEngine set_value event gate", () => {
  beforeEach(() => loadActiveRulesMock.mockReset());

  const setValueRule = {
    _id: "r",
    label: "r",
    entity: "X",
    event: "validate",
    actions: [{ type: "set_value", field: "foo", value: "'bar'" }],
  };

  it("returns the accumulated mutations and mutates the doc at validate", async () => {
    loadActiveRulesMock.mockResolvedValue([setValueRule]);
    const engine = new RuleEngine(throwingDb(), registry);
    const doc: Record<string, unknown> = {};
    const muts = await engine.execute("X", "validate", doc, user, {} as never);
    expect(muts).toEqual({ foo: "bar" });
    expect(doc.foo).toBe("bar");
  });

  it("THROWS when a set_value rule runs at a post-write event (on_submit)", async () => {
    loadActiveRulesMock.mockResolvedValue([{ ...setValueRule, event: "on_submit" }]);
    const engine = new RuleEngine(throwingDb(), registry);
    await expect(engine.execute("X", "on_submit", {}, user, {} as never)).rejects.toThrow(
      /set_value not allowed/,
    );
  });

  it("returns {} for an event with no rules", async () => {
    loadActiveRulesMock.mockResolvedValue([]);
    const engine = new RuleEngine(throwingDb(), registry);
    expect(await engine.execute("X", "on_update", {}, user, {} as never)).toEqual({});
  });
});
