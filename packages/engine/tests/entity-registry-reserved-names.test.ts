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
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

// The app serves its own pages at /account, /app/* and /login, matched case-sensitively,
// so only these exact lowercase names would lose their list page to the app.
const entity = (name: string) => ({
  name,
  module: "test",
  database: "app",
  naming: { strategy: "user_set" },
  fields: [{ fieldname: "title", fieldtype: "Data", label: "Title" }],
  permissions: [],
});

async function loadOne(name: string): Promise<{ registry: EntityRegistry; file: string; load: Promise<void>; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reg-reserved-"));
  const file = join(dir, `${name}.entity.json`);
  await writeFile(file, JSON.stringify(entity(name)));
  const registry = new EntityRegistry();
  return { registry, file, dir, load: registry.loadAll(dir) };
}

describe("entity names the app's own pages take", () => {
  it.each(["account", "app", "login"])("refuses an entity named %s, naming the reserved words and the file", async (name) => {
    const { file, dir, load } = await loadOne(name);
    const error = await load.then(() => undefined, (e: unknown) => e as Error);
    await rm(dir, { recursive: true, force: true });
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain(file);
    expect(error!.message).toContain(`"${name}"`);
    expect(error!.message).toContain("account, app, login");
  });

  it.each(["_jobs", "_groups"])("refuses an entity named %s, in the namespace of the app's own pages", async (name) => {
    const { dir, load } = await loadOne(name);
    const error = await load.then(() => undefined, (e: unknown) => e as Error);
    await rm(dir, { recursive: true, force: true });
    expect(error?.message).toContain(`"${name}"`);
  });

  it.each(["Account", "App", "Login", "Jobs"])("loads an entity named %s", async (name) => {
    const { registry, dir, load } = await loadOne(name);
    await load;
    await rm(dir, { recursive: true, force: true });
    expect(registry.get(name).name).toBe(name);
  });
});

describe("a stored definition with a reserved name", () => {
  it("is skipped by the boot's load from the database, which goes on", async () => {
    const stored = ["login", "_groups", "Login"].map((name) => ({ ...entity(name), fields: [...entity(name).fields] }));
    const db = { find: vi.fn(async () => stored) } as unknown as MongoDBService;
    const registry = new EntityRegistry();
    await registry.loadFromDb(db);
    expect([registry.has("login"), registry.has("_groups"), registry.has("Login")]).toEqual([false, false, true]);
  });
});
