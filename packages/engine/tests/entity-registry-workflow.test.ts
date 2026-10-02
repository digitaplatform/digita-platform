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

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

// A workflow with two initial states, or a transition to a state nobody declared, boots silently and
// fails only when a document meets it. The registry refuses such an entity file when it loads it.
const entity = (states: unknown[], transitions: unknown[]) => ({
  name: "Loan",
  module: "test",
  database: "app",
  naming: { strategy: "uuid" },
  fields: [{ fieldname: "status", fieldtype: "Select", label: "Status", options: ["draft", "lent", "returned"] }],
  permissions: [],
  states,
  transitions,
});

async function load(def: unknown): Promise<{ error: Error | undefined; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reg-workflow-"));
  const file = join(dir, "Loan.entity.json");
  await writeFile(file, JSON.stringify(def));
  const error = await new EntityRegistry().loadAll(dir).then(() => undefined, (e: unknown) => e as Error);
  await rm(dir, { recursive: true, force: true });
  return { error, file };
}

const states = [{ value: "draft", is_initial: true }, { value: "lent" }, { value: "returned" }];

describe("the workflow of an entity file", () => {
  it("refuses two initial states, naming the file, the entity and the states", async () => {
    const { error, file } = await load(entity([{ value: "draft", is_initial: true }, { value: "lent", is_initial: true }], []));
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain(file);
    expect(error!.message).toContain('"Loan"');
    expect(error!.message).toContain("multiple is_initial states: draft, lent");
  });

  it("refuses a transition to a state nobody declared", async () => {
    const { error } = await load(entity(states, [{ from: "draft", to: "archived" }]));
    expect(error!.message).toContain('transition.to "archived" is not a declared state');
  });

  it("loads a consistent workflow, a way out of a terminal state included", async () => {
    const { error } = await load(entity(states, [{ from: "draft", to: "lent" }, { from: "lent", to: "returned" }, { from: "returned", to: "draft" }]));
    expect(error).toBeUndefined();
  });
});
