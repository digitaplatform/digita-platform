import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginConfig } from "../src/core/plugins/plugin-config.js";

/** Write a plugins.config.json into a fresh temp app dir and return its path. */
function appDir(root: string, name: string, config: unknown): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugins.config.json"), JSON.stringify(config), "utf-8");
  return dir;
}

describe("loadPluginConfig — audiences map (ADR-A3)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "digita-plugincfg-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults audiences to {} when no app declares one (internal-only app)", async () => {
    const dir = appDir(root, "a", { layout: { template: "classic", regions: {} } });
    const rt = await loadPluginConfig([dir]);
    expect(rt.audiences).toEqual({});
  });

  it("parses + relays a valid audiences map verbatim", async () => {
    const dir = appDir(root, "a", {
      audiences: {
        anonymous: { enabled: true, runtime: "web", entry: "https://shop.acme.com" },
        external: { enabled: true, runtime: "spa", home: "/portal" },
        internal: { enabled: true },
      },
    });
    const rt = await loadPluginConfig([dir]);
    expect(rt.audiences.anonymous).toEqual({ enabled: true, runtime: "web", entry: "https://shop.acme.com" });
    expect(rt.audiences.external?.home).toBe("/portal");
    expect(rt.audiences.internal?.enabled).toBe(true);
  });

  it("later app dirs win per tier (merge semantics)", async () => {
    const a = appDir(root, "a", { audiences: { internal: { enabled: true }, external: { enabled: false } } });
    const b = appDir(root, "b", { audiences: { external: { enabled: true, home: "/shop" } } });
    const rt = await loadPluginConfig([a, b]);
    expect(rt.audiences.internal?.enabled).toBe(true); // untouched by b
    expect(rt.audiences.external).toEqual({ enabled: true, home: "/shop" }); // b wins
  });

  it("fails loud when audiences is not an object", async () => {
    const dir = appDir(root, "a", { audiences: ["internal"] });
    await expect(loadPluginConfig([dir])).rejects.toThrow(/audiences.*must be an object/);
  });

  it("fails loud on an unknown tier key", async () => {
    const dir = appDir(root, "a", { audiences: { operator: { enabled: true } } });
    await expect(loadPluginConfig([dir])).rejects.toThrow(/not one of/);
  });

  it("fails loud when a tier config lacks a boolean `enabled`", async () => {
    const dir = appDir(root, "a", { audiences: { internal: { runtime: "spa" } } });
    await expect(loadPluginConfig([dir])).rejects.toThrow(/boolean "enabled"/);
  });
});
