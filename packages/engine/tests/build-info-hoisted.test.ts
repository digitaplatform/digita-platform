import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../docker/build-info.mjs", import.meta.url));
const tag = "0.4.001-stable-20261003220000-abcdef0";
const name = (part: string) => `@digitaplatform/${part}`;
const dependencies = (...parts: string[]) =>
  Object.fromEntries(parts.map((part) => [name(part), "^99.0.0"]));

it.each([
  false, true,
])("installed graph: hoisted=%s", (hoisted) => {
  const bundledDev = false;
  const dir = mkdtempSync(join(tmpdir(), "engine-build-info-"));
  try {
    const pkg = (base: string, part: string) => join(base, "node_modules", name(part));
    const write = (base: string, part: string, version: string,
      deps = {}, devDeps = {}) => {
      mkdirSync(base, { recursive: true });
      writeFileSync(join(base, "package.json"), JSON.stringify({
        name: name(part), version, dependencies: deps, devDependencies: devDeps,
        private: true, secret: "private-manifest-sentinel",
      }));
    };
    const root = join(dir, "app");
    write(root, "engine", "0.4.1", dependencies("shared", "kit"), dependencies("design"));
    write(pkg(root, "shared"), "shared", "0.3.51", dependencies("leaf"),
      dependencies("internal-dev"));
    write(pkg(root, "kit"), "kit", "0.2.7", dependencies("leaf"));
    write(pkg(root, "design"), "design", "0.8.2", dependencies("palette"),
      dependencies("internal-dev"));
    write(pkg(root, "unused"), "unused", "9.9.9");
    write(join(dir, "unused-sibling"), "sibling", "9.9.9");
    write(pkg(root, "internal-dev"), "internal-dev", "9.9.9");
    for (const parent of ["shared", "kit"]) {
      write(pkg(hoisted ? root : pkg(root, parent), "leaf"), "leaf", "1.2.3");
    }
    write(pkg(hoisted ? root : pkg(root, "design"), "palette"), "palette", "2.3.4");
    const expected = ["engine@0.4.1", "shared@0.3.51", "kit@0.2.7", "leaf@1.2.3",
      ...(bundledDev ? ["design@0.8.2", "palette@2.3.4"] : [])]
      .map((entry) => {
        const [part, version] = entry.split("@");
        if (!part || !version) throw new Error("invalid package fixture");
        return { name: name(part), version };
      }).sort((a, b) => a.name.localeCompare(b.name));
    for (const version of [undefined, tag]) {
      const output = join(dir, "build-info.json");
      const run = spawnSync(process.execPath, [script, "digita-platform",
        join(root, "package.json"), output, ...(bundledDev ? ["bundled-dev"] : [])], {
        cwd: dir, encoding: "utf8", timeout: 5000,
        env: { ...(version ? { BUILD_VERSION: version } : {}),
          AUTH_JWT_PRIVATE_KEY: "private-environment-sentinel" },
      });
      expect(run.error).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const result = JSON.parse(readFileSync(output, "utf8"));
      expect(result).toEqual({
        name: "digita-platform", ...(version ? { version } : {}),
        subpackages: expect.any(Array),
      });
      expect(result.subpackages.sort((a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name))).toEqual(expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
