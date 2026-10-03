import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    SERVICE_NAME: "digita-test",
    MONGODB_URI: "",
    MONGODB_MIN_POOL: 1,
    MONGODB_MAX_POOL: 5,
    MONGODB_TIMEOUT_MS: 30000,
    MONGODB_RETRY_WRITES: true,
    MONGODB_IDENTITY_DB: "test_users",
    MONGODB_LOGS_DB: "test_logs",
    MONGODB_AUDITS_DB: "test_audits",
    MONGODB_CORE_DB: "test_admin",
    MONGODB_APP_DB_PREFIX: "test",
    TRANSLATION_SOURCE: "mongodb",
    TRANSLATION_FALLBACK_LOCALE: "en",
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Collection } from "mongodb";
import { DIGITA } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { TranslationService } from "../src/core/i18n/translation-service.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let translationService: TranslationService;
let tempDir: string;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as unknown as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection(DIGITA.COLLECTIONS.TRANSLATION, DIGITA.DATABASES.CORE);
  translationService = new TranslationService(db);
}, 60000);

afterAll(async () => {
  await db?.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.collection(DIGITA.COLLECTIONS.TRANSLATION, DIGITA.DATABASES.CORE).deleteMany({});
  tempDir = await mkdtemp(join(tmpdir(), "trans-seed-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempDir, { recursive: true, force: true });
});

describe("TranslationService.seedFromFiles with MongoDB source", () => {
  it("skips marked row, keeps ID and unique reservation without resurrecting", async () => {
    const deletedAt = new Date("2026-03-01T10:00:00Z");
    const initialModified = new Date("2026-02-01T10:00:00Z");
    const markedRow = {
      _id: "system:en:label_save",
      namespace: "system",
      locale: "en",
      key: "label_save",
      value: "Old Retained Save",
      source: "file",
      overridden: false,
      deleted: deletedAt,
      deleted_by: "admin@digita.local",
      owner: "system",
      modified_by: "admin@digita.local",
      creation: initialModified,
      modified: initialModified,
    };
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, markedRow, DIGITA.DATABASES.CORE);

    await writeFile(
      join(tempDir, "en.json"),
      JSON.stringify({ label_save: "New File Save", label_cancel: "Cancel" }),
      "utf-8",
    );

    const summary = await translationService.seedFromFiles(tempDir);
    expect(summary).toEqual({ inserted: 1, skipped: 1 });

    const stored = await db.findOne(
      DIGITA.COLLECTIONS.TRANSLATION,
      "system:en:label_save",
      DIGITA.DATABASES.CORE,
      undefined,
      { includeDeleted: true },
    );
    expect(stored).toMatchObject({
      _id: "system:en:label_save",
      value: "Old Retained Save",
      deleted_by: "admin@digita.local",
    });
    expect(stored?.["deleted"]).toEqual(deletedAt);
    expect(stored?.["modified"]).toEqual(initialModified);

    expect(await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "system:en:label_save", DIGITA.DATABASES.CORE)).toBeNull();

    const newStored = await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "system:en:label_cancel", DIGITA.DATABASES.CORE);
    expect(newStored).toMatchObject({
      _id: "system:en:label_cancel",
      value: "Cancel",
      source: "file",
    });

  });

  it("preserves caller override and deletion raced after probe via CAS, and counts actual matched rows", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const rowDel = {
      _id: "system:en:raced_del",
      namespace: "system",
      locale: "en",
      key: "raced_del",
      value: "Initial Value 1",
      source: "file",
      overridden: false,
      owner: "system",
      modified_by: "system",
      creation: createdAt,
      modified: createdAt,
    };
    const rowOvr = {
      _id: "system:en:raced_ovr",
      namespace: "system",
      locale: "en",
      key: "raced_ovr",
      value: "Initial Value 2",
      source: "file",
      overridden: false,
      owner: "system",
      modified_by: "system",
      creation: createdAt,
      modified: createdAt,
    };
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, rowDel, DIGITA.DATABASES.CORE);
    await db.insertOne(DIGITA.COLLECTIONS.TRANSLATION, rowOvr, DIGITA.DATABASES.CORE);

    await writeFile(
      join(tempDir, "en.json"),
      JSON.stringify({ raced_del: "File Updated 1", raced_ovr: "File Updated 2" }),
      "utf-8",
    );

    const col = db.collection(DIGITA.COLLECTIONS.TRANSLATION, DIGITA.DATABASES.CORE) as Collection;
    vi.spyOn(db, "collection").mockReturnValue(col);
    const origFind = col.find.bind(col);

    vi.spyOn(col, "find").mockImplementationOnce((...args) => {
      const cursor = origFind(...args);
      const origToArray = cursor.toArray.bind(cursor);
      cursor.toArray = async () => {
        const found = await origToArray();
        const raceTime = new Date("2026-03-02T12:00:00Z");
        await col.updateOne(
          { _id: "system:en:raced_del" as never },
          { $set: { deleted: raceTime, deleted_by: "raced-delete@digita.local", modified: raceTime } },
        );
        await col.updateOne(
          { _id: "system:en:raced_ovr" as never },
          { $set: { overridden: true, value: "User Override Won", modified_by: "admin@digita.local", modified: raceTime } },
        );
        return found;
      };
      return cursor;
    });

    const summary = await translationService.seedFromFiles(tempDir);

    expect(summary).toEqual({ inserted: 0, skipped: 2 });

    const storedDel = await db.findOne(
      DIGITA.COLLECTIONS.TRANSLATION,
      "system:en:raced_del",
      DIGITA.DATABASES.CORE,
      undefined,
      { includeDeleted: true },
    );
    expect(storedDel?.["deleted"]).toBeInstanceOf(Date);
    expect(storedDel?.["deleted_by"]).toBe("raced-delete@digita.local");
    expect(storedDel?.["value"]).toBe("Initial Value 1");

    const storedOvr = await db.findOne(DIGITA.COLLECTIONS.TRANSLATION, "system:en:raced_ovr", DIGITA.DATABASES.CORE);
    expect(storedOvr?.["overridden"]).toBe(true);
    expect(storedOvr?.["value"]).toBe("User Override Won");

  });
});
