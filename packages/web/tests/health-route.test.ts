import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ readFileSync: vi.fn() }));
vi.mock("node:fs", () => fs);

// Anonymous metadata must not depend on session or runtime site config.
vi.mock("next/headers", () => ({
  cookies: () => { throw new Error("Unexpected session access"); },
  headers: () => { throw new Error("Unexpected request-header access"); },
}));
vi.mock("../src/config/env", () => ({
  getConfig: () => { throw new Error("Unexpected config access"); },
}));

import { dynamic, GET } from "../src/app/health/route";

const tag = "0.4.001-stable-20261003220000-abcdef0";
const subpackages = [
  { name: "@digitaplatform/web", version: "0.4.1" },
  { name: "@digitaplatform/components", version: "0.4.0" },
];

beforeEach(() => {
  fs.readFileSync.mockReset();
  fs.readFileSync.mockReturnValue(JSON.stringify({
    name: "digita-platform",
    version: tag,
    subpackages,
  }));
  vi.stubEnv("BUILD_VERSION", tag);
});

afterEach(() => vi.unstubAllEnvs());

describe("anonymous web health metadata", () => {
  it("returns exact public metadata and the complete baked tag", async () => {
    const response = GET();

    expect(dynamic).toBe("force-dynamic");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      name: "digita-platform",
      version: tag,
      subpackages,
    });
    expect(fs.readFileSync).toHaveBeenCalledWith(
      "/app/packages/web/build-info.json",
      "utf8",
    );
  });

  it.each([undefined, ""])(
    "omits version and does not read metadata when BUILD_VERSION is %s",
    async (value) => {
      vi.stubEnv("BUILD_VERSION", value);

      expect(await GET().json()).toEqual({ name: "digita-platform" });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    },
  );

  it("does not guess a version from a mismatched runtime override", async () => {
    vi.stubEnv("BUILD_VERSION", "0.4.002-beta-20261003220100-abcdef1");

    expect(await GET().json()).toEqual({
      name: "digita-platform",
      subpackages,
    });
  });

  it("strips private baked fields at both levels", async () => {
    fs.readFileSync.mockReturnValue(JSON.stringify({
      name: "digita-platform",
      version: tag,
      internalEngineUrl: "http://engine.internal:3000",
      privateToken: "PRIVATE_SENTINEL",
      subpackages: subpackages.map((pkg) => ({
        ...pkg,
        privateToken: "PRIVATE_SENTINEL",
      })),
    }));

    expect(await GET().json()).toEqual({
      name: "digita-platform",
      version: tag,
      subpackages,
    });
  });
});
