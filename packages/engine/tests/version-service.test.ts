import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("../src/core/config/env.js", () => {
  return { env: { MONGODB_URI: "", MONGODB_MIN_POOL: 1, MONGODB_MAX_POOL: 5, MONGODB_TIMEOUT_MS: 30000, MONGODB_RETRY_WRITES: true, MONGODB_IDENTITY_DB: "test_users", MONGODB_LOGS_DB: "test_logs", MONGODB_AUDITS_DB: "test_audits", MONGODB_CORE_DB: "test_admin", MONGODB_APP_DB_PREFIX: "test" } };
});
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { VersionService } from "../src/core/version/version-service.js";
import type { BaseDocument } from "../src/core/document/base-document.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let versionService: VersionService;

const makeDoc = (): BaseDocument =>
  ({
    doctype: "VerTestDoc",
    _id: "VT-0001",
    _original: { title: "a" },
    _data: { title: "b" },
    getChangedFields: () => ["title"],
  }) as unknown as BaseDocument;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection("_versions", "audits");
  versionService = new VersionService(db);
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
}, 30000);

describe("VersionService.createVersion — unique _id under same-millisecond writes", () => {
  it("does not collide (E11000) when two tracked writes land in the same millisecond", async () => {
    // Freeze the clock so both version _ids share the same `doctype:name:timestamp`
    // prefix — the exact condition that previously produced a duplicate-key error
    // inside the parent transaction.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234567890000);
    try {
      await versionService.createVersion(makeDoc(), "u@test");
      await expect(versionService.createVersion(makeDoc(), "u@test")).resolves.toBeUndefined();
    } finally {
      nowSpy.mockRestore();
    }

    const versions = await versionService.getVersions("VerTestDoc", "VT-0001");
    expect(versions.length).toBe(2);
  });
});
