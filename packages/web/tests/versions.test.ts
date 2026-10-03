import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../src/config/env", () => ({
  getConfig: () => ({ engineUrl: "http://engine.internal:3000" }),
}));
// Exercise the actual parser source, without depending on rebuilt package output.
vi.mock("@digitaplatform/components", async () =>
  import("../../components/src/lib/build-info")
);

import { getEngineBuildInfo } from "../src/lib/versions";

const tag = "0.4.001-stable-20261003220000-abcdef0";
const metadata = {
  name: "digita-platform",
  version: tag,
  subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1" }],
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("server engine metadata", () => {
  it("uses the internal URL only for fetching and returns exact metadata", async () => {
    fetchMock.mockResolvedValue(Response.json(metadata));

    const result = await getEngineBuildInfo();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://engine.internal:3000/health",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(metadata);
    expect(JSON.stringify(result)).not.toContain("engine.internal");
  });

  it.each(["alpha", "beta", "stable"])(
    "preserves a complete %s builder tag",
    async (channel) => {
      const body = {
        ...metadata,
        version: `0.4.001-${channel}-20261003220000-abcdef0`,
      };
      fetchMock.mockResolvedValue(Response.json(body));

      expect(await getEngineBuildInfo()).toEqual(body);
    },
  );

  it.each([
    ["null", null],
    ["missing image version", {
      name: metadata.name,
      subpackages: metadata.subpackages,
    }],
    ["numeric image version", { ...metadata, version: 401 }],
    ["release-only version", { ...metadata, version: "0.4.1" }],
    ["wrong channel", {
      ...metadata, version: "0.4.001-preview-20261003220000-abcdef0",
    }],
    ["short timestamp", {
      ...metadata, version: "0.4.001-stable-20261003-abcdef0",
    }],
    ["short SHA", {
      ...metadata, version: "0.4.001-stable-20261003220000-abcdef",
    }],
    ["unknown image", { ...metadata, name: "unknown-image" }],
    ["non-array packages", { ...metadata, subpackages: "engine" }],
    ["empty packages", { ...metadata, subpackages: [] }],
    ["invalid package", {
      ...metadata, subpackages: [{ name: "@digitaplatform/engine", version: 401 }],
    }],
    ["private top-level data", {
      ...metadata, engineUrl: "http://engine.internal:3000",
    }],
    ["private package data", {
      ...metadata,
      subpackages: [{ ...metadata.subpackages[0], privateToken: "PRIVATE_SENTINEL" }],
    }],
  ])("omits metadata with %s", async (_label, body) => {
    fetchMock.mockResolvedValue(Response.json(body));

    expect(await getEngineBuildInfo()).toBeNull();
  });

  it("omits network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    expect(await getEngineBuildInfo()).toBeNull();
  });

  it("omits HTTP failures without reading their body", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 503, json } as unknown as Response);

    expect(await getEngineBuildInfo()).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });

  it("omits malformed JSON", async () => {
    fetchMock.mockResolvedValue(new Response("{", {
      headers: { "Content-Type": "application/json" },
    }));

    expect(await getEngineBuildInfo()).toBeNull();
  });
});
