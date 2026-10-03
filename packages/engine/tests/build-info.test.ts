import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../../docker/build-info.mjs", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "digita-build-info-"));
  roots.push(root);
  const manifest = join(root, "package.json");
  const output = join(root, "build-info.json");
  const write = (file: string, value: unknown) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  write(manifest, { name: "@digitaplatform/engine", version: "0.4.1", dependencies: { "@digitaplatform/shared": "^0.3.0" } });
  write(join(root, "node_modules/@digitaplatform/shared/package.json"), { name: "@digitaplatform/shared", version: "0.4.0" });
  write(join(root, "unused/package.json"), { name: "@digitaplatform/app", version: "9.9.9" });
  return { root, manifest, output, write };
}
function bake(f: ReturnType<typeof fixture>, version: string, extra: string[] = []) {
  execFileSync(process.execPath, [script, "digita-platform", f.manifest, f.output, ...extra], {
    env: { ...process.env, BUILD_VERSION: version, PRIVATE_BUILD_SECRET: "never-public" },
  });
  return JSON.parse(readFileSync(f.output, "utf8")) as { name: string; version: string; subpackages: { name: string; version: string }[] };
}
describe("image build metadata", () => {
it("generates app metadata from the shipped inventory", () => {
  const dockerfile = readFileSync(new URL("../../../docker/app.Dockerfile", import.meta.url), "utf8");
  const command = "RUN node docker/build-info.mjs digita-platform packages/app/package.json packages/app/build-info.json packages/app/dist/plugins/index.json free";
  expect(dockerfile).toContain(command);
  expect(dockerfile.indexOf(command)).toBeGreaterThan(
    dockerfile.indexOf("rm -rf packages/app/dist/plugins packages/app/dist/plugins-premium"),
  );
});

it.each([true, false])("describes shipped app plugins when inventory exists: %s", (shipped) => {
  const f = fixture();
  f.write(f.manifest, { name: "@digitaplatform/app", version: "0.4.1" });
  const inventory = { plugins: [
    { id: "minimal", tier: "free", version: "0.3.12" },
    { id: "editorial", tier: "premium", version: "0.4.0" },
  ] };
  f.write(join(f.root, "public/plugins/index.json"), inventory);
  const dist = join(f.root, "dist/plugins/index.json");
  if (shipped) f.write(dist, inventory);
  expect(bake(f, "0.4.001-stable-20261003220000-abcdef0", [dist, "free"]).subpackages)
    .toEqual([{ name: "@digitaplatform/app", version: "0.4.1" },
      ...(shipped ? [{ name: "minimal", version: "0.3.12" }] : [])]);
});

  it("uses the image argument and actual installed packages, with no sibling guess or private fields", () => {
    const f = fixture();
    expect(bake(f, "0.4.001-stable-20261003220000-abcdef0")).toEqual({
      name: "digita-platform", version: "0.4.001-stable-20261003220000-abcdef0",
      subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1" }, { name: "@digitaplatform/shared", version: "0.4.0" }],
    });
    expect(bake(f, "0.4.002-stable-20261003220100-abcdef1").version).toBe("0.4.002-stable-20261003220100-abcdef1");
  });
  it("omits malformed image versions and preserves the exact full tag", () => {
    const f = fixture();
    const tag = "0.4.001-stable-20261003220000-abcdef0";
    for (const version of ["", "latest", "0.4.1",
      tag.slice(0, -7) + "ABCDEF0", `${tag}-junk`, `${tag}\n`, tag]) {
      expect(bake(f, version)).toEqual({
        name: "digita-platform", ...(version === tag ? { version: tag } : {}),
        subpackages: [
          { name: "@digitaplatform/engine", version: "0.4.1" },
          { name: "@digitaplatform/shared", version: "0.4.0" },
        ],
      });
    }
  });

  it("omits a missing image version rather than substituting the source manifest", () => {
    const f = fixture();
    expect(bake(f, "")).toEqual({ name: "digita-platform", subpackages: [{ name: "@digitaplatform/engine", version: "0.4.1" }, { name: "@digitaplatform/shared", version: "0.4.0" }] });
  });
  it("includes only the staged plugin tier this image ships", () => {
    const f = fixture();
    const inventory = join(f.root, "plugins.json");
    f.write(inventory, { plugins: [{ id: "editorial", tier: "premium", version: "0.4.0" }, { id: "minimal", tier: "free", version: "0.3.12" }] });
    expect(bake(f, "0.4.001-stable-20261003220000-abcdef0", [inventory, "premium"]).subpackages).toEqual([
      { name: "@digitaplatform/engine", version: "0.4.1" }, { name: "@digitaplatform/shared", version: "0.4.0" }, { name: "editorial", version: "0.4.0" },
    ]);
  });
  it("fails if a declared project dependency is not installed", () => {
    const f = fixture();
    f.write(f.manifest, { name: "@digitaplatform/engine", version: "0.4.1", dependencies: { "@digitaplatform/missing": "1.0.0" } });
    expect(() => bake(f, "0.4.001-stable-20261003220000-abcdef0")).toThrow();
  });
});
