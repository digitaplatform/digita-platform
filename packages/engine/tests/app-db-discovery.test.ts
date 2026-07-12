import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    MONGODB_URI: "mongodb://localhost:27017",
    MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "u", MONGODB_LOGS_DB: "l", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "a",
    MONGODB_APP_DB_PREFIX: "test",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { discoverDomainDirectories, registerAppDatabases } from "../src/core/database/app-db-discovery.js";
import { MongoDBService } from "../src/core/database/mongodb-service.js";

let appDir: string;

beforeAll(async () => {
  appDir = await mkdtemp(join(tmpdir(), "appdiscover-"));
  // Domain folders with entities/ inside.
  for (const d of ["master", "accounting", "sales"]) {
    await mkdir(join(appDir, d, "entities"), { recursive: true });
    await writeFile(
      join(appDir, d, "entities", "x.entity.json"),
      JSON.stringify({ name: "x", module: "m", fields: [], permissions: [], naming: { strategy: "user_set" } }),
    );
  }
  // Reserved sibling that must NOT be treated as a domain.
  await mkdir(join(appDir, "entities"), { recursive: true });
  await mkdir(join(appDir, "modules"), { recursive: true });
  await mkdir(join(appDir, "_internal"), { recursive: true });
  // Domain candidate without entities/ — must be skipped.
  await mkdir(join(appDir, "stale"), { recursive: true });
});

afterAll(async () => {
  await rm(appDir, { recursive: true, force: true });
});

describe("discoverDomainDirectories", () => {
  it("returns one entry per subfolder with an entities/ child", async () => {
    const found = await discoverDomainDirectories(appDir);
    const names = found.map((d) => d.domain).sort();
    expect(names).toEqual(["accounting", "master", "sales"]);
  });

  it("logical dbName is `<appname>_<domain>`", async () => {
    const found = await discoverDomainDirectories(appDir);
    const master = found.find((d) => d.domain === "master")!;
    expect(master.dbName).toBe(`${master.app}_master`);
  });

  it("ignores reserved subfolders (entities, modules, _internal) and entityless candidates (stale)", async () => {
    const found = await discoverDomainDirectories(appDir);
    const names = found.map((d) => d.domain);
    expect(names).not.toContain("entities");
    expect(names).not.toContain("modules");
    expect(names).not.toContain("_internal");
    expect(names).not.toContain("stale");
  });
});

describe("MongoDBService.registerAppDatabase", () => {
  it("rejects reserved names", () => {
    const db = new MongoDBService();
    expect(() => db.registerAppDatabase({ name: "identity" })).toThrow(/reserved/);
    expect(() => db.registerAppDatabase({ name: "logs" })).toThrow(/reserved/);
    expect(() => db.registerAppDatabase({ name: "core" })).toThrow(/reserved/);
  });

  it("derives physical name from the prefix when not given", () => {
    const db = new MongoDBService();
    db.registerAppDatabase({ name: "master" });
    const list = db.listAppDatabases();
    expect(list[0]!.physical).toBe("test_master");
  });

  it("normalises `-` to `_` in derived physical names", () => {
    const db = new MongoDBService();
    db.registerAppDatabase({ name: "erp-master" });
    expect(db.listAppDatabases()[0]!.physical).toBe("test_erp_master");
  });

  it("throws on conflicting re-register", () => {
    const db = new MongoDBService();
    db.registerAppDatabase({ name: "master", physical: "x_master" });
    expect(() => db.registerAppDatabase({ name: "master", physical: "y_master" })).toThrow(/already registered/);
  });

  it("idempotent re-register with same physical name", () => {
    const db = new MongoDBService();
    db.registerAppDatabase({ name: "master", physical: "x_master" });
    expect(() => db.registerAppDatabase({ name: "master", physical: "x_master" })).not.toThrow();
  });
});

describe("registerAppDatabases", () => {
  it("registers every discovered domain on the MongoDBService", async () => {
    const db = new MongoDBService();
    await registerAppDatabases(db, [appDir]);
    const names = db.listAppDatabases().map((d) => d.name).sort();
    const app = (await discoverDomainDirectories(appDir))[0]!.app;
    expect(names).toEqual([`${app}_accounting`, `${app}_master`, `${app}_sales`]);
  });
});
