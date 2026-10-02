// A demo data operation wipes an app's data, or for a load nothing, and seeds it again. One
// operation runs per app at a time, and a seed that fails runs again before the operation fails,
// naming the error.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({ env: { DEMO_TENANT: true, SITE_ID: "" } }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const { seedAppData } = vi.hoisted(() => ({ seedAppData: vi.fn() }));
vi.mock("../src/core/setup/seed-app-data.js", () => ({ seedAppData, DEMO_SEED_DIR: "seeds-demo" }));
vi.mock("../src/core/setup/seed-data-translations.js", () => ({ seedDataTranslations: vi.fn().mockResolvedValue(undefined) }));

import { findLastFailure, reseedAppData, type ReseedDeps, type ReseedRequest } from "../src/core/setup/reseed-app-data.js";
import { beginWrite, runningReseedMode } from "../src/core/setup/reseed-lock.js";

const deleteMany = vi.fn();
const deps = {
  db: {
    listAppDatabases: () => [{ name: "app_x" }],
    deleteMany,
    collection: () => ({ find: () => ({ toArray: async () => [] }) }),
  },
  storage: {},
  registry: { getAll: () => [{ name: "Thing", database: "app_x" }] },
  translationService: {},
  appDirs: ["/app"],
  getDomainDirs: () => [],
} as unknown as ReseedDeps;

const RESET: ReseedRequest = { operation: "reset", demoTier: true, keepConfiguration: false };
const REMOVE: ReseedRequest = { operation: "remove", demoTier: false, keepConfiguration: false };
const LOAD: ReseedRequest = { operation: "load", demoTier: true, keepConfiguration: true };

/** How often the app's rows were wiped. */
const wipes = () => deleteMany.mock.calls.filter(([collection]) => collection === "Thing").length;

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue(3);
  seedAppData.mockReset().mockResolvedValue({ unresolved_links: [] });
});

describe("a demo data operation", () => {
  it("runs once for two calls while it runs, and answers both with its result", async () => {
    seedAppData.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ unresolved_links: [] }), 20)));
    const [first, second] = await Promise.all([reseedAppData(RESET, deps), reseedAppData(RESET, deps)]);
    expect(wipes()).toBe(1);
    expect(second).toBe(first);
    expect(first.rows_deleted).toBe(3);
  });

  it("PLANTED INNOCENT: runs again once the earlier reset has ended", async () => {
    await reseedAppData(RESET, deps);
    await reseedAppData(RESET, deps);
    expect(wipes()).toBe(2);
  });

  it("refuses another operation while one runs, naming both", async () => {
    seedAppData.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ unresolved_links: [] }), 20)));
    const demo = reseedAppData(RESET, deps);
    await expect(reseedAppData(REMOVE, deps)).rejects.toThrow("the demo data operation reset is running; start remove once it has ended");
    await demo;
  });

  it("seeds again when the seed after the wipe fails once, and succeeds", async () => {
    seedAppData.mockRejectedValueOnce(new Error("disk full"));
    await expect(reseedAppData(RESET, deps)).resolves.toMatchObject({ operation: "reset" });
    expect(seedAppData).toHaveBeenCalledTimes(2);
  });

  it("fails, saying the app is empty and why, when the seed fails again", async () => {
    seedAppData.mockRejectedValue(new Error("disk full"));
    await expect(reseedAppData(RESET, deps)).rejects.toThrow(
      "the seed failed 2 times; the app holds only the rows seeded before the failure: disk full",
    );
    expect(findLastFailure()).toContain("disk full");
    // The lock is released after a failure, so the next reset can repair the app.
    seedAppData.mockReset().mockResolvedValue({ unresolved_links: [] });
    await expect(reseedAppData(RESET, deps)).resolves.toMatchObject({ operation: "reset" });
    expect(findLastFailure()).toBeUndefined();
  });
});

describe("an operation's wait for writes under way", () => {
  it("PLANTED DEFECT: gives up after 60 s, naming the writes, wiping nothing, and clears its mark", async () => {
    vi.useFakeTimers();
    const end = beginWrite("action spawn on Thing");
    try {
      const refused = expect(reseedAppData(RESET, deps)).rejects.toThrow(
        "the operation waited 60 s for writes that had not ended, and changed nothing: action spawn on Thing",
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await refused;
      expect(wipes()).toBe(0);
      expect(runningReseedMode()).toBeUndefined();
    } finally {
      end();
      vi.useRealTimers();
    }
  });

  it("PLANTED INNOCENT: wipes once the write ends before the bound", async () => {
    vi.useFakeTimers();
    const end = beginWrite("insert Thing");
    try {
      const reset = reseedAppData(RESET, deps);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(wipes()).toBe(0);
      end();
      await expect(reset).resolves.toMatchObject({ operation: "reset" });
      expect(wipes()).toBe(1);
    } finally {
      end();
      vi.useRealTimers();
    }
  });
});

describe("a load", () => {
  it("wipes nothing, seeds both tiers, and refuses writes while it runs", async () => {
    let markedWhileSeeding: string | undefined;
    seedAppData.mockImplementation(async (_db: unknown, _registry: unknown, _naming: unknown, dirs: string[]) => {
      markedWhileSeeding = runningReseedMode();
      expect(dirs).toEqual(["/app/seeds", "/app/seeds-demo"]);
      return { unresolved_links: [] };
    });
    await expect(reseedAppData(LOAD, deps)).resolves.toMatchObject({ operation: "load", rows_deleted: 0 });
    expect(wipes()).toBe(0);
    expect(markedWhileSeeding).toBe("load");
    expect(runningReseedMode()).toBeUndefined();
  });
});
