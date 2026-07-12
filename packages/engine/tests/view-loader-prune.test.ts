// Regression test for orphaned View rows: `seedViewsFromFiles` seeds every
// view found in the current `<appDir>/views/**.view.json` files, but
// (pre-fix) never removed a DB row whose backing file was deleted or
// renamed — that stale row kept resolving through the registry forever.
//
// Deleting those rows is destructive and irreversible at boot time, so the
// prune itself is gated behind `PRUNE_ORPHAN_VIEWS` (default OFF), mirroring
// the `PRUNE_ORPHAN_INDEXES` / `PRUNE_ORPHAN_COLLECTIONS` precedent: with the
// flag off, orphans are only detected + logged (survive); with it on, they
// are actually deleted. Admin-overridden (intentionally DB-only) rows are
// left untouched either way.
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

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
    PRUNE_ORPHAN_VIEWS: false,
  },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
  getRootLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { DIGITA } from "@digitaplatform/shared";
import { MongoDBService } from "../src/core/database/mongodb-service.js";
import { seedViewsFromFiles } from "../src/core/view/view-loader.js";
import { env } from "../src/core/config/env.js";

let replSet: MongoMemoryReplSet;
let db: MongoDBService;
let appDir: string;

const KEPT_VIEW = {
  _id: "kept-widget",
  name: "Kept Widget",
  anchored: false,
  sections: [{ key: "detail", kind: "link", entity: "Widget", target: "ref" }],
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  (env as { MONGODB_URI: string }).MONGODB_URI = replSet.getUri();
  db = new MongoDBService();
  await db.connect();
  await db.ensureCollection(DIGITA.COLLECTIONS.VIEW, DIGITA.DATABASES.CORE);

  // A single current file view — its file stays present across every test.
  appDir = await mkdtemp(join(tmpdir(), "view-loader-prune-"));
  await mkdir(join(appDir, "views"), { recursive: true });
  await writeFile(
    join(appDir, "views", "kept-widget.view.json"),
    JSON.stringify(KEPT_VIEW),
  );
}, 60000);

afterAll(async () => {
  await db.disconnect();
  await replSet.stop();
  await rm(appDir, { recursive: true, force: true });
}, 30000);

beforeEach(async () => {
  await db.deleteMany(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE);
  // Default back to off before every test; individual tests opt in.
  (env as unknown as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS = false;
});

describe("seedViewsFromFiles — orphan pruning (PRUNE_ORPHAN_VIEWS=true)", () => {
  beforeEach(() => {
    (env as unknown as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS = true;
  });

  it("deletes a DB row whose backing file was removed or renamed", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "removed-widget", name: "Removed Widget", sections: [], overridden: false },
      DIGITA.DATABASES.CORE,
    );

    await seedViewsFromFiles(db, [appDir]);

    const row = await db.findOne(DIGITA.COLLECTIONS.VIEW, "removed-widget", DIGITA.DATABASES.CORE);
    expect(row).toBeNull();
  });

  it("keeps an admin-overridden DB-only row (no backing file, by design)", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "admin-only-widget", name: "Admin Widget", sections: [], overridden: true },
      DIGITA.DATABASES.CORE,
    );

    await seedViewsFromFiles(db, [appDir]);

    const row = await db.findOne(DIGITA.COLLECTIONS.VIEW, "admin-only-widget", DIGITA.DATABASES.CORE);
    expect(row).not.toBeNull();
    expect(row?.["overridden"]).toBe(true);
  });

  it("keeps and re-seeds views still backed by a current file", async () => {
    await seedViewsFromFiles(db, [appDir]);

    const row = await db.findOne(DIGITA.COLLECTIONS.VIEW, "kept-widget", DIGITA.DATABASES.CORE);
    expect(row).not.toBeNull();
    expect(row?.["name"]).toBe("Kept Widget");
  });

  it("reports the pruned count in the seed summary and leaves unrelated rows untouched", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "removed-widget", name: "Removed Widget", sections: [], overridden: false },
      DIGITA.DATABASES.CORE,
    );
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "admin-only-widget", name: "Admin Widget", sections: [], overridden: true },
      DIGITA.DATABASES.CORE,
    );

    const summary = await seedViewsFromFiles(db, [appDir]);

    expect(summary.orphans_detected).toBe(1);
    expect(summary.pruned).toBe(1);
    expect(summary.loaded).toBe(1);

    const remaining = (await db.find(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE))
      .map((d) => d["_id"])
      .sort();
    expect(remaining).toEqual(["admin-only-widget", "kept-widget"]);
  });
});

describe("seedViewsFromFiles — orphan pruning (PRUNE_ORPHAN_VIEWS=false, default)", () => {
  beforeEach(() => {
    (env as unknown as { PRUNE_ORPHAN_VIEWS: boolean }).PRUNE_ORPHAN_VIEWS = false;
  });

  it("does NOT delete a DB row whose backing file was removed — it survives", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "removed-widget", name: "Removed Widget", sections: [], overridden: false },
      DIGITA.DATABASES.CORE,
    );

    await seedViewsFromFiles(db, [appDir]);

    const row = await db.findOne(DIGITA.COLLECTIONS.VIEW, "removed-widget", DIGITA.DATABASES.CORE);
    expect(row).not.toBeNull();
  });

  it("still keeps an admin-overridden DB-only row (no backing file, by design)", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "admin-only-widget", name: "Admin Widget", sections: [], overridden: true },
      DIGITA.DATABASES.CORE,
    );

    await seedViewsFromFiles(db, [appDir]);

    const row = await db.findOne(DIGITA.COLLECTIONS.VIEW, "admin-only-widget", DIGITA.DATABASES.CORE);
    expect(row).not.toBeNull();
    expect(row?.["overridden"]).toBe(true);
  });

  it("reports the orphan as detected (not pruned) in the seed summary, and leaves it in place", async () => {
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "removed-widget", name: "Removed Widget", sections: [], overridden: false },
      DIGITA.DATABASES.CORE,
    );
    await db.insertOne(
      DIGITA.COLLECTIONS.VIEW,
      { _id: "admin-only-widget", name: "Admin Widget", sections: [], overridden: true },
      DIGITA.DATABASES.CORE,
    );

    const summary = await seedViewsFromFiles(db, [appDir]);

    expect(summary.orphans_detected).toBe(1);
    expect(summary.pruned).toBe(0);
    expect(summary.loaded).toBe(1);

    const remaining = (await db.find(DIGITA.COLLECTIONS.VIEW, {}, DIGITA.DATABASES.CORE))
      .map((d) => d["_id"])
      .sort();
    expect(remaining).toEqual(["admin-only-widget", "kept-widget", "removed-widget"]);
  });
});
