import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A setting the engine parses and nothing reads promises a knob that does nothing, and a typo in
// it still stops the engine at start-up. Every key of env.ts is read by name outside env.ts.
const SRC = join(__dirname, "../src");
const ENV_FILE = join(SRC, "core/config/env.ts");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && path !== ENV_FILE ? [path] : [];
  });
}

/** The keys env.ts declares: `  NAME: getEnv…(` at the start of a line. */
function settingKeys(text: string): string[] {
  return [...text.matchAll(/^ {2}([A-Z][A-Z0-9_]*): get\w*\(/gm)].map((m) => m[1]!);
}

/** The keys of `keys` that no text of `texts` reads: as a member (`env.<KEY>`, or `settings.<KEY>`
 *  of a part that takes the settings it needs) or by its quoted name. */
function unread(keys: string[], texts: string[]): string[] {
  return keys.filter((key) => !texts.some((text) => new RegExp(`\\.${key}\\b|["']${key}["']`).test(text)));
}

describe("the settings of env.ts", () => {
  it("names a planted setting nothing reads, and passes one that is read", () => {
    const planted = `export const env = {\n  READ_ME: getEnv("READ_ME", "a"),\n  NOBODY_READS: getEnvInt("NOBODY_READS", 1),\n};`;
    expect(settingKeys(planted)).toEqual(["READ_ME", "NOBODY_READS"]);
    expect(unread(settingKeys(planted), ["const x = env.READ_ME;"])).toEqual(["NOBODY_READS"]);
  });

  it("are each read somewhere in the engine", () => {
    const keys = settingKeys(readFileSync(ENV_FILE, "utf8"));
    expect(keys.length).toBeGreaterThan(40);
    expect(unread(keys, sources(SRC).map((file) => readFileSync(file, "utf8")))).toEqual([]);
  });
});
