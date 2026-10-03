import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ info: { name: "digita-platform", version: "0.4.001-stable-20261003220000-abcdef0", subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1", privateSetting: "never-public" }], privateSetting: "never-public" } }));
vi.mock("node:fs", () => ({ readFileSync: (url: URL) => JSON.stringify(url.pathname.endsWith("/package.json") ? { version: "0.4.1" } : fixture.info) }));
import { getBuildInfo } from "../src/core/config/build-version.js";

afterEach(() => vi.unstubAllEnvs());
describe("image health metadata", () => {
  it("reports only names and versions baked into the image", () => {
    vi.stubEnv("BUILD_VERSION", fixture.info.version);
    expect(getBuildInfo()).toEqual({ name: "digita-platform", version: fixture.info.version, subpackages: fixture.info.subpackages.map(({ name, version }) => ({ name, version })) });
  });
  it("has no image version when the builder supplied none", () => {
    vi.stubEnv("BUILD_VERSION", "");
    expect(getBuildInfo()).toEqual({ name: "digita-platform" });
  });
  it("does not present a runtime override as the baked version", () => {
    vi.stubEnv("BUILD_VERSION", "0.4.002-stable-20261003220100-abcdef1");
    expect(getBuildInfo()).toEqual({ name: "digita-platform", subpackages: fixture.info.subpackages.map(({ name, version }) => ({ name, version })) });
  });
});
