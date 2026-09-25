// The website takes its whole look from the app's theme and component kit: no colour, surface
// radius or type size of its own. This scans every source file for the shapes such a value takes,
// and proves each rule on a planted defect and on planted innocent neighbours.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** A hard-coded design value, by the shape it takes in a class list or a string. */
const RULES: { name: string; pattern: RegExp }[] = [
  { name: "colour literal", pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/ },
  { name: "fixed white or black", pattern: /\b(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration)-(?:white|black)\b/ },
  { name: "surface radius outside the theme tokens", pattern: /\brounded(?:-[trblse]{1,2})?-(?:lg|xl|2xl|3xl)\b/ },
  { name: "arbitrary value on a design utility", pattern: /\b(?:text|bg|rounded|shadow|border|font|leading|tracking|ring|fill|stroke|from|via|to)-\[/ },
];

function violations(file: string, text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) found.push(`${file}:${i + 1} ${rule.name}: ${line.trim()}`);
    }
  });
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("the website carries no design value of its own", () => {
  const files = sources(SRC);

  it("reads the whole source tree, so a clean answer means it was looked at", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("layout.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("components.tsx"))).toBe(true);
  });

  it("finds no colour, fixed radius or arbitrary design value", () => {
    const found = files.flatMap((f) => violations(relative(SRC, f), readFileSync(f, "utf8")));
    expect(found, "take the value from the theme's tokens or the component kit").toEqual([]);
  });
});

describe("PROBES: each rule catches its shape and nothing else", () => {
  it("catches a planted value of every shape", () => {
    for (const planted of [
      `color: "#0e6fb8"`,
      `background: rgba(0, 0, 0, .3)`,
      `className="text-white"`,
      `className="bg-black/30"`,
      `className="rounded-2xl border"`,
      `className="rounded-t-xl"`,
      `className="text-[13px]"`,
      `className="shadow-[0_0_4px_red]"`,
    ]) {
      expect(violations("x.tsx", planted), planted).toHaveLength(1);
    }
  });

  it("PLANTED INNOCENT: tokens, anchors and layout values pass", () => {
    for (const innocent of [
      `href="#main"`,
      `className="rounded-card rounded-btn rounded-input rounded-full rounded-md"`,
      `className="text-onPrimary bg-primary-600 border-border text-textMain"`,
      `className="[overflow-wrap:anywhere] grid-cols-[1fr_auto_auto] max-w-3xl"`,
      `className="text-micro text-xs md:text-6xl"`,
    ]) {
      expect(violations("x.tsx", innocent), innocent).toEqual([]);
    }
  });
});
