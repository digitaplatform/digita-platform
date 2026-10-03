// The demo reset wipes an app's data and seeds it again. One reset runs per app at a time, and a
// seed that fails after the wipe runs again before the reset fails, naming the error.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({ env: {
  DEMO_TENANT: true, SITE_ID: "", TRANSLATIONS_DIR: process.env["TRANSLATIONS_DIR"], TRANSLATION_FALLBACK_LOCALE: "en",
} }));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn, error: vi.fn() }),
}));
const { seedAppData, warn } = vi.hoisted(() => ({ seedAppData: vi.fn(), warn: vi.fn() }));
vi.mock("../src/core/setup/seed-app-data.js", () => ({ seedAppData }));
vi.mock("../src/core/setup/seed-data-translations.js", () => ({ seedDataTranslations: vi.fn().mockResolvedValue(undefined) }));

import { reseedAppData, type ReseedDeps } from "../src/core/setup/reseed-app-data.js";
import { beginWrite, runningReseedMode } from "../src/core/setup/reseed-lock.js";
import { ConfigurationError } from "../src/core/errors/engine-error.js";
import { englishText, loadEngineI18n } from "../src/i18n.js";

const deleteMany = vi.fn();
const deps = {
  db: {
    listAppDatabases: () => [{ name: "app_x" }],
    deleteMany,
  },
  registry: { getAll: () => [{ name: "Thing", database: "app_x" }] },
  translationService: {},
  appDirs: ["/app"],
  getDomainDirs: () => [],
} as unknown as ReseedDeps;

/** How often the app's rows were wiped. */
const wipes = () => deleteMany.mock.calls.filter(([collection]) => collection === "Thing").length;

beforeAll(() => { loadEngineI18n(); });

beforeEach(() => {
  warn.mockClear();
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
    await expect(reseedAppData("template", deps)).rejects.toMatchObject({ code: "reseed_running", params: { running: "demo", requested: "template" } });
    await demo;
  });

  it("seeds again when the seed after the wipe fails once, and succeeds", async () => {
    seedAppData.mockRejectedValueOnce(new Error("disk full"));
    await expect(reseedAppData("demo", deps)).resolves.toMatchObject({ mode: "demo" });
    expect(seedAppData).toHaveBeenCalledTimes(2);
  });

  it("fails, saying the app is empty and why, when the seed fails again", async () => {
    seedAppData.mockRejectedValue(new Error("disk full"));
    await expect(reseedAppData("demo", deps)).rejects.toMatchObject({
      code: "reseed_seed_failed",
      params: { attempts: "2", error: "disk full" },
    });
    // The lock is released after a failure, so the next reset can repair the app.
    seedAppData.mockReset().mockResolvedValue({ unresolved_links: [] });
    await expect(reseedAppData("demo", deps)).resolves.toMatchObject({ mode: "demo" });
  });

  it("preserves a coded seed error's parameters and original cause after both attempts", async () => {
    const cause = new ConfigurationError("seed_row_docstatus_invalid", { doctype: "Thing", row: "T-3", value: "5" });
    seedAppData.mockRejectedValue(cause);
    const reason = englishText(cause.code, cause.params);
    expect(reason).toContain("Thing");
    expect(reason).toContain("T-3");
    expect(reason).toContain("5");
    await expect(reseedAppData("demo", deps)).rejects.toMatchObject({
      code: "reseed_seed_failed", params: { attempts: "2", error: reason }, cause,
    });
    expect(warn).toHaveBeenCalledWith({ attempt: 1, err: cause }, "seed after the wipe failed; running it again");
  });
});

describe("the demo reset's wait for writes under way", () => {
  it("PLANTED DEFECT: gives up after 60 s, naming the writes, wiping nothing, and clears its mark", async () => {
    vi.useFakeTimers();
    const end = beginWrite("action spawn on Thing");
    try {
      const refused = expect(reseedAppData("demo", deps)).rejects.toMatchObject({
        code: "reseed_writes_running",
        params: { seconds: "60", writes: "action spawn on Thing" },
      });
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
      const reset = reseedAppData("demo", deps);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(wipes()).toBe(0);
      end();
      await expect(reset).resolves.toMatchObject({ mode: "demo" });
      expect(wipes()).toBe(1);
    } finally {
      end();
      vi.useRealTimers();
    }
  });
});
