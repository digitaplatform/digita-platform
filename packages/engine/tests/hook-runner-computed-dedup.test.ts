// Regression test for the computed-hook deduplication behavior added
// to HookRunner.runComputedHooks. When the same handler is registered
// for multiple fields (a common pattern: one computeTotals function
// covering subtotal + tax_amount + grand_total), it must run ONCE per
// save, not N×. The handlers are usually idempotent, so per-field
// invocation was wasteful (N× DB reads) but not incorrect; the dedupe
// keeps the wasted work down.
import { vi, describe, it, expect } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1,
    MONGODB_MAX_POOL: 5,
    MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users",
    MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { HookRunner } from "../src/core/hooks/hook-runner.js";
import { BaseDocument } from "../src/core/document/base-document.js";

describe("HookRunner.runComputedHooks dedup", () => {
  it("runs the SAME handler once even when registered for multiple fields", async () => {
    const runner = new HookRunner();
    const calls = { total: 0 };
    const handler = async () => { calls.total++; };

    // Manually populate the internal hook map (mirrors what loadHooks
    // would do for an entity with `computed: {a: "...", b: "...", c: "..."}` all
    // pointing at the same module.fn).
    const entityHooks = new Map();
    entityHooks.set("computed:a", handler);
    entityHooks.set("computed:b", handler);
    entityHooks.set("computed:c", handler);
    (runner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set("TestDoc", entityHooks);

    const doc = new BaseDocument("TestDoc", { _id: "T-1" });
    await runner.runComputedHooks("TestDoc", doc);

    expect(calls.total).toBe(1);
  });

  it("runs DIFFERENT handlers each, in entity-JSON insertion order", async () => {
    const runner = new HookRunner();
    const sequence: string[] = [];
    const handlerA = async () => { sequence.push("A"); };
    const handlerB = async () => { sequence.push("B"); };

    const entityHooks = new Map();
    entityHooks.set("computed:f1", handlerA);
    entityHooks.set("computed:f2", handlerB);
    entityHooks.set("computed:f3", handlerA);  // same as f1, deduped
    entityHooks.set("computed:f4", handlerB);  // same as f2, deduped
    (runner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set("TestDoc", entityHooks);

    const doc = new BaseDocument("TestDoc", { _id: "T-2" });
    await runner.runComputedHooks("TestDoc", doc);

    expect(sequence).toEqual(["A", "B"]);
  });

  it("no-op when entity has no hooks registered", async () => {
    const runner = new HookRunner();
    const doc = new BaseDocument("Unknown", { _id: "U-1" });
    await expect(runner.runComputedHooks("Unknown", doc)).resolves.toBeUndefined();
  });

  it("ignores non-computed entries (validate, before_save, etc.)", async () => {
    const runner = new HookRunner();
    const calls = { computed: 0, validate: 0 };
    const computedFn = async () => { calls.computed++; };
    const validateFn = async () => { calls.validate++; };

    const entityHooks = new Map();
    entityHooks.set("computed:total", computedFn);
    entityHooks.set("validate", validateFn);                  // NOT a computed entry
    entityHooks.set("on_field_change:status", validateFn);    // NOT a computed entry
    (runner as unknown as { hooks: Map<string, Map<string, unknown>> }).hooks.set("TestDoc", entityHooks);

    const doc = new BaseDocument("TestDoc", { _id: "T-3" });
    await runner.runComputedHooks("TestDoc", doc);

    expect(calls.computed).toBe(1);
    expect(calls.validate).toBe(0);
  });
});
