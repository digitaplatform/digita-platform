import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBodyLimit } from "../src/core/api/http-options.js";

// The settings of the public create (digitaplatform/digita-platform#36): a value a limiter would read
// as no budget, or as no window, stops the boot and names the variable.

describe("the public create's settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async () => (await import("../src/core/config/env.js")).env;

  it("refuses a budget that is not a whole number of 1 or more, naming it", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    for (const bad of ["0", "-1", "1.5", "abc", " 5"]) {
      vi.resetModules();
      vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_MAX", bad);
      await expect(load()).rejects.toMatchObject({ code: "setting_not_whole_number", params: { setting: "API_PUBLIC_CREATE_RATE_LIMIT_MAX", min: "1" } });
    }
  });

  it("refuses a window that is no duration above zero, naming it", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    for (const bad of ["abc", "60", "0m", "1 minute", "-1m"]) {
      vi.resetModules();
      vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_WINDOW", bad);
      await expect(load()).rejects.toMatchObject({ code: "setting_not_duration", params: { setting: "API_PUBLIC_CREATE_RATE_LIMIT_WINDOW" } });
    }
  });

  it("reads a budget and a window, and falls back to 5 per minute", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_MAX", "7");
    vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_WINDOW", "30s");
    const env = await load();
    expect([env.API_PUBLIC_CREATE_RATE_LIMIT_MAX, env.API_PUBLIC_CREATE_RATE_LIMIT_WINDOW]).toEqual([7, 30_000]);
    vi.resetModules();
    vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_MAX", "");
    vi.stubEnv("API_PUBLIC_CREATE_RATE_LIMIT_WINDOW", "");
    const fallback = await load();
    expect([fallback.API_PUBLIC_CREATE_RATE_LIMIT_MAX, fallback.API_PUBLIC_CREATE_RATE_LIMIT_WINDOW]).toEqual([5, 60_000]);
  });
});

describe("parseBodyLimit", () => {
  it("reads sizes and refuses anything else, naming the setting", () => {
    expect(parseBodyLimit("16kb", "X")).toBe(16 * 1024);
    expect(parseBodyLimit("10mb", "X")).toBe(10 * 1024 * 1024);
    expect(parseBodyLimit("512", "X")).toBe(512);
    for (const bad of ["", "16 kilobytes", "-1kb", "1.5mb"]) {
      expect(() => parseBodyLimit(bad, "API_PUBLIC_CREATE_MAX_BODY_SIZE")).toThrow(expect.objectContaining({ code: "setting_not_size", params: { setting: "API_PUBLIC_CREATE_MAX_BODY_SIZE", value: bad } }));
    }
  });
});
