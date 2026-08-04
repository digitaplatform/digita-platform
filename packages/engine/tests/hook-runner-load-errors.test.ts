import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l",
    MONGODB_AUDITS_DB: "a", MONGODB_CORE_DB: "c", MONGODB_APP_DB_PREFIX: "test",
  },
}));
// Shared across every createLogger() call so the load report can be read back:
// with the engine booting through, that log line is the only boot-time signal.
const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error, fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error, fatal: vi.fn() }),
}));

import type { BaseDocument } from "../src/core/document/base-document.js";
import type { EntityDefinition } from "@digitaplatform/shared";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";
import { HookModuleLoadError, HookRunner, UnresolvedHookError } from "../src/core/hooks/hook-runner.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "digita-hook-load-"));
  await mkdir(join(dir, "mod", "ent"), { recursive: true });
  // `.ts` is tried first and EXISTS here (so no missing-file fallthrough — that
  // path's error shape is Node/tsx-specific and not reproducible under vitest).
  // Valid module exporting the hook.
  await writeFile(join(dir, "mod", "ent", "ok.ts"), "export const fn = () => 42;\n", "utf-8");
  // Present-but-BROKEN module (throws while initializing) — parses fine, but its
  // import() rejects with a plain Error (NOT ERR_MODULE_NOT_FOUND), which the
  // discriminating catch must surface + rethrow rather than silently swallow.
  await writeFile(
    join(dir, "mod", "ent", "broken.ts"),
    "throw new Error('module init boom');\nexport const fn = () => {};\n",
    "utf-8",
  );
  // Present module exporting something ELSE than the declared name.
  await writeFile(join(dir, "mod", "ent", "other.ts"), "export const somethingElse = () => {};\n", "utf-8");
});

function entity(name: string, hooks: Record<string, unknown>): EntityDefinition {
  return { name, hooks } as unknown as EntityDefinition;
}

const doc = { _id: "INV-0001" } as unknown as BaseDocument;

/** The load report — one log.error carrying every open declaration. */
function loadReport(): string {
  return JSON.stringify(error.mock.calls.filter((c) => JSON.stringify(c).includes("resolve to no function")));
}

beforeEach(() => error.mockClear());

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeRunner(): { loadHookFunction: (p: string) => Promise<unknown> } {
  const runner = new HookRunner() as unknown as {
    moduleDirs: string[];
    loadHookFunction: (p: string) => Promise<unknown>;
  };
  runner.moduleDirs = [dir];
  return runner;
}

describe("HookRunner.loadHookFunction — broken modules surface loudly (not silently disabled)", () => {
  it("loads a valid hook module", async () => {
    const fn = await makeRunner().loadHookFunction("mod/ent/ok.fn");
    expect(typeof fn).toBe("function");
  });

  it("REJECTS when a present hook module throws on import (was silently swallowed → null)", async () => {
    await expect(makeRunner().loadHookFunction("mod/ent/broken.fn")).rejects.toThrow("module init boom");
  });
});

describe("HookRunner.loadHooks — the engine boots, and every open declaration is reported", () => {
  it("BOOTS and reports entity, slot, reference and searched dirs at error (was debug + skip)", async () => {
    const runner = new HookRunner();
    await runner.loadHooks([entity("Invoice", { on_submit: "mod/ent/nowhere.post" })], [dir]);

    // A tenant whose module vanished in a deploy keeps a running system.
    expect((runner as unknown as { loaded: boolean }).loaded).toBe(true);

    const report = loadReport();
    expect(report).toContain("Invoice");
    expect(report).toContain("on_submit");
    expect(report).toContain("mod/ent/nowhere.post");
    // The searched candidates are named, so the fix does not need guesswork.
    expect(report).toContain(JSON.stringify(join(dir, "mod", "ent", "nowhere.ts")).slice(1, -1));
  });

  it("reports a declaration in EVERY slot kind in ONE error (event, field change, computed, action)", async () => {
    const runner = new HookRunner();
    await runner.loadHooks(
      [
        entity("Invoice", {
          on_submit: "mod/ent/nowhere.post",
          on_field_change: { amount: "mod/ent/nowhere.onAmount" },
          computed: { total: "mod/ent/nowhere.total" },
          actions: { reopen: "mod/ent/nowhere.reopen" },
        }),
      ],
      [dir],
    );

    const report = loadReport();
    expect(report).toContain("[on_submit]");
    expect(report).toContain("[on_field_change:amount]");
    expect(report).toContain("[computed:total]");
    expect(report).toContain("[action:reopen]");
    // One line names all four, instead of one per restart.
    expect(report).toContain("4 hook declaration(s)");
  });

  it("reports a module that exists but exports no such function (was warn + skip)", async () => {
    const runner = new HookRunner();
    await runner.loadHooks([entity("Invoice", { validate: "mod/ent/other.fn" })], [dir]);
    expect(loadReport()).toContain('exports no \\"fn\\"');
  });

  it("reports a reference with no function part", async () => {
    const runner = new HookRunner();
    await runner.loadHooks([entity("Invoice", { validate: "mod/ent/ok" })], [dir]);
    expect(loadReport()).toContain("names no function");
  });

  it("carries the unresolved marker so registerHook can tell it from a broken import", async () => {
    await expect(makeRunner().loadHookFunction("mod/ent/nowhere.post")).rejects.toBeInstanceOf(
      UnresolvedHookError,
    );
  });

  it("LOADS the platform's OWN entity definitions — no shipped hook may report unresolved", async () => {
    // Same two dirs app.ts hands the runner when APP_DIRS is empty, so a typo in a
    // shipped entity.hooks entry is caught here instead of at the next boot.
    const registry = new EntityRegistry();
    await registry.loadAll("./src/entities");
    const runner = new HookRunner();
    await runner.loadHooks(registry.getAll(), ["./src/modules"]);
    expect(loadReport()).toBe("[]");
  });

  it("LOADS when every declaration resolves, and a present-but-broken module does NOT stop the load", async () => {
    const runner = new HookRunner();
    // A broken deploy must not take the system down — it takes the operations
    // that needed the hook down, which the calling suite below proves.
    await runner.loadHooks(
      [entity("Invoice", { validate: "mod/ent/ok.fn", on_submit: "mod/ent/broken.fn" })],
      [dir],
    );
    expect((runner as unknown as { loaded: boolean }).loaded).toBe(true);
    // A broken import is NOT an unresolved declaration: it stays out of that
    // report, because a missing module and a broken module need different fixes.
    expect(loadReport()).toBe("[]");
  });
});

describe("HookRunner — CALLING an unresolved hook fails the operation (never a silent pass)", () => {
  /** One runner whose Invoice declares four hooks that resolve nowhere. */
  async function loadedRunner(): Promise<HookRunner> {
    const runner = new HookRunner();
    await runner.loadHooks(
      [
        entity("Invoice", {
          on_submit: "mod/ent/nowhere.post",
          computed: { total: "mod/ent/nowhere.total" },
          actions: { reopen: "mod/ent/nowhere.reopen" },
        }),
        entity("Note", { on_submit: "mod/ent/ok.fn" }),
      ],
      [dir],
    );
    return runner;
  }

  it("run() THROWS with entity, slot and reference — the save does not go through as if validated", async () => {
    const runner = await loadedRunner();
    const err = await runner
      .run("Invoice", "on_submit", doc)
      .then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(UnresolvedHookError);
    expect(err?.message).toContain("Invoice");
    expect(err?.message).toContain("on_submit");
    expect(err?.message).toContain("mod/ent/nowhere.post");
    // The same message the load reported, so both ends read identically
    // (sliced out of a JSON encoding, hence the escaping round-trip).
    expect(loadReport()).toContain(JSON.stringify(String(err?.message)).slice(1, -1));
  });

  it("runAction() THROWS instead of returning undefined, which the route reads as a no-op action", async () => {
    const runner = await loadedRunner();
    // The action counts as handled — the failure must come from the call, not
    // from the route's handler-less branch.
    expect(runner.hasActionHandler("Invoice", "reopen")).toBe(true);
    await expect(runner.runAction("Invoice", "reopen", doc)).rejects.toBeInstanceOf(
      UnresolvedHookError,
    );
  });

  it("runComputedHooks() THROWS — a computed field cannot silently keep a stale value", async () => {
    const runner = await loadedRunner();
    await expect(runner.runComputedHooks("Invoice", doc)).rejects.toThrow(/computed:total/);
  });

  it("an entity with NO declaration is unchanged — nothing to call, nothing to fail", async () => {
    const runner = await loadedRunner();
    await expect(runner.run("Invoice", "before_cancel", doc)).resolves.toBeUndefined();
    await expect(runner.run("Unknown", "on_submit", doc)).resolves.toBeUndefined();
    expect(await runner.runAction("Invoice", "not_declared", doc)).toBeUndefined();
  });

  it("a RESOLVED declaration on another entity still runs", async () => {
    const runner = await loadedRunner();
    await expect(runner.run("Note", "on_submit", doc)).resolves.toBeUndefined();
  });
});

describe("HookRunner — a module that EXISTS but throws on import fails the same way at the call", () => {
  /** Boot survives a broken deploy; the operations that needed the hook do not. */
  async function brokenRunner(): Promise<HookRunner> {
    const runner = new HookRunner();
    await runner.loadHooks(
      [
        entity("Ledger", {
          on_submit: "mod/ent/broken.fn",
          actions: { repost: "mod/ent/broken.fn" },
        }),
      ],
      [dir],
    );
    expect((runner as unknown as { loaded: boolean }).loaded).toBe(true);
    return runner;
  }

  it("run() THROWS carrying the IMPORT's own message, plus entity, slot and reference", async () => {
    const runner = await brokenRunner();
    const err = await runner
      .run("Ledger", "on_submit", doc)
      .then(() => null, (e: Error) => e);

    expect(err).toBeInstanceOf(HookModuleLoadError);
    // The import's message, not "resolves to no function" — that is what names
    // the actual breakage.
    expect(err?.message).toContain("module init boom");
    expect(err?.message).toContain("Ledger");
    expect(err?.message).toContain("on_submit");
    expect(err?.message).toContain("mod/ent/broken.fn");
    // The original error stays reachable, so its stack survives the wrapping.
    expect((err as HookModuleLoadError).cause).toBeInstanceOf(Error);
    expect(((err as HookModuleLoadError).cause as Error).message).toBe("module init boom");
  });

  it("runAction() THROWS instead of returning undefined", async () => {
    const runner = await brokenRunner();
    expect(runner.hasActionHandler("Ledger", "repost")).toBe(true);
    await expect(runner.runAction("Ledger", "repost", doc)).rejects.toThrow("module init boom");
  });
});
