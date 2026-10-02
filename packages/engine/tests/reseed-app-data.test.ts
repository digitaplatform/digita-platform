// The demo reset wipes an app's data and seeds it again. One reset runs per app at a time, and a
// seed that fails after the wipe runs again before the reset fails, naming the error.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({ env: { DEMO_TENANT: true, SITE_ID: "" } }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
const { seedAppData } = vi.hoisted(() => ({ seedAppData: vi.fn() }));
vi.mock("../src/core/setup/seed-app-data.js", () => ({ seedAppData }));
vi.mock("../src/core/setup/seed-data-translations.js", () => ({ seedDataTranslations: vi.fn().mockResolvedValue({ unresolved_links: [] }) }));

import { reseedAppData, type ReseedDeps } from "../src/core/setup/reseed-app-data.js";

const deleteMany = vi.fn();
const deps = {
  db: {
    listAppDatabases: () => [{ name: "app_x" }],
    deleteMany,
    updateOne: vi.fn().mockResolvedValue({ unresolved_links: [] }),
  },
  registry: { getAll: () => [{ name: "Thing", database: "app_x" }] },
  translationService: {},
  appDirs: ["/app"],
  getDomainDirs: () => [],
} as unknown as ReseedDeps;

/** How often the app's rows were wiped. */
const wipes = () => deleteMany.mock.calls.filter(([collection]) => collection === "Thing").length;

beforeEach(() => {
  deleteMany.mockReset().mockResolvedValue(3);
  seedAppData.mockReset().mockResolvedValue({ unresolved_links: [] });
});

describe("the demo reset", () => {
  it("runs once for two calls while it runs, and answers both with its result", async () => {
    seedAppData.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ unresolved_links: [] }), 20)));
    const [first, second] = await Promise.all([reseedAppData("demo", deps), reseedAppData("demo", deps)]);
    expect(wipes()).toBe(1);
    expect(second).toBe(first);
    expect(first.rows_deleted).toBe(3);
  });

  it("PLANTED INNOCENT: runs again once the earlier reset has ended", async () => {
    await reseedAppData("demo", deps);
    await reseedAppData("demo", deps);
    expect(wipes()).toBe(2);
  });

  it("refuses a reset in the other mode while one runs, naming both", async () => {
    seedAppData.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ unresolved_links: [] }), 20)));
    const demo = reseedAppData("demo", deps);
    await expect(reseedAppData("template", deps)).rejects.toThrow("a reseed in mode demo is running; start the reseed in mode template once it has ended");
    await demo;
  });

  it("seeds again when the seed after the wipe fails once, and succeeds", async () => {
    seedAppData.mockRejectedValueOnce(new Error("disk full"));
    await expect(reseedAppData("demo", deps)).resolves.toMatchObject({ mode: "demo" });
    expect(seedAppData).toHaveBeenCalledTimes(2);
  });

  it("fails, saying the app is empty and why, when the seed fails again", async () => {
    seedAppData.mockRejectedValue(new Error("disk full"));
    await expect(reseedAppData("demo", deps)).rejects.toThrow(
      "the seed failed 2 times after the app data was wiped; the app holds only the rows seeded before the failure: disk full",
    );
    // The lock is released after a failure, so the next reset can repair the app.
    seedAppData.mockReset().mockResolvedValue({ unresolved_links: [] });
    await expect(reseedAppData("demo", deps)).resolves.toMatchObject({ mode: "demo" });
  });
});
