import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a", MONGODB_APP_DB_PREFIX: "test",
  },
}));
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { EntityRegistry } from "../src/core/entity/entity-registry.js";

const okEntity = (name: string) => ({
  name,
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [],
});

beforeEach(() => warn.mockClear());

describe("EntityRegistry load errors + duplicates (A13)", () => {
  it("FAILS BOOT on a malformed .entity.json (was silently skipped)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-load-"));
    await writeFile(join(dir, "broken.entity.json"), "{ this is not valid json ");
    const registry = new EntityRegistry();
    await expect(registry.loadAll(dir)).rejects.toThrow(/Malformed entity definition/);
    await rm(dir, { recursive: true, force: true });
  });

  it("WARNS when a name is redefined from a different file (later wins, override still works)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reg-dup-"));
    await writeFile(join(dir, "a.entity.json"), JSON.stringify({ ...okEntity("Dup"), module: "core" }));
    await writeFile(join(dir, "b.entity.json"), JSON.stringify({ ...okEntity("Dup"), module: "app" }));
    const registry = new EntityRegistry();
    await registry.loadAll(dir);
    // The redefinition is surfaced (no longer silent) …
    expect(
      warn.mock.calls.some((c) => JSON.stringify(c).includes("redefined by a later file")),
    ).toBe(true);
    // … and the later definition still wins (intentional app-over-core override preserved).
    expect(registry.get("Dup").module).toBe("app");
    await rm(dir, { recursive: true, force: true });
  });
});
