import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
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
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { HookRunner } from "../src/core/hooks/hook-runner.js";

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
});

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
