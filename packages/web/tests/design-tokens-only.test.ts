// The website takes its whole look from the app's theme and component kit: no colour, radius,
// shadow or font of its own. The theme's Tailwind preset only EXTENDS Tailwind, so Tailwind's own
// palette, radii, shadows and serif stack stay usable and would bypass the theme. This scans every
// source file for the shapes such a value takes, and proves each rule on a planted defect and on
// planted innocent neighbours.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(WEB, "src");

/** Tailwind's default palette; the theme's own colour names (primary, neutral, accent, …) are not in it. */
const PALETTE = "slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOUR_UTILITY = String.raw`(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|outline|decoration|accent|caret|fill|stroke|from|via|to|placeholder|shadow)`;
const CSS_LIKE = /\.(css|svg)$/;
const SCRIPT = /\.(tsx?|mjs)$/;

/** A hard-coded design value, by the shape it takes in a class list, a style, CSS or SVG. */
const RULES: { name: string; pattern: RegExp; files?: RegExp }[] = [
  { name: "colour literal", pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/ },
  {
    name: "colour from Tailwind's palette instead of the theme",
    pattern: new RegExp(String.raw`\b${COLOUR_UTILITY}-(?:white|black|(?:${PALETTE})-\d{2,3})\b`),
  },
  {
    name: "named colour in CSS",
    pattern: /\b(?:color|background(?:-color)?|fill|stroke|stop-color|outline-color|border(?:-(?:top|right|bottom|left))?-color)\s*:\s*(?!var\(|currentColor|transparent|inherit|initial|unset|none)[a-zA-Z]+\s*(?:[;}!]|$)/i,
    files: CSS_LIKE,
  },
  {
    name: "named colour in an SVG or JSX attribute",
    pattern: /\b(?:fill|stroke|stop-color|stopColor|flood-color|floodColor)\s*=\s*\{?\s*["'](?!none|currentColor|transparent|inherit|url\()[a-zA-Z]+["']/,
  },
  {
    name: "named colour in a style object",
    pattern: /\b(?:color|background(?:Color)?|fill|stroke|stopColor|outlineColor|border(?:Top|Right|Bottom|Left)?Color)\s*:\s*["'](?!var\(|currentColor|transparent|inherit|none)[a-zA-Z]+["']/,
    files: SCRIPT,
  },
  { name: "radius outside the theme tokens", pattern: /(?<![\w-])rounded(?:-[trblse]{1,2})?(?:-(?:none|sm|md|lg|xl|2xl|3xl))?(?![\w-])/ },
  { name: "shadow outside the theme tokens", pattern: /\bdrop-shadow\b|(?<![\w-])shadow(?:-(?:xl|2xl|inner))?(?![\w-])/ },
  { name: "font outside the theme tokens", pattern: /(?<![\w-])font-serif(?![\w-])|\bfont-?[fF]amily\s*:\s*["']?(?!var\()/ },
  { name: "arbitrary value on a design utility", pattern: /\b(?:text|bg|rounded|shadow|border|font|leading|tracking|ring|fill|stroke|from|via|to)-\[/ },
];

function violations(file: string, text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(file)) continue;
      if (rule.pattern.test(line)) found.push(`${file}:${i + 1} ${rule.name}: ${line.trim()}`);
    }
  });
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|mjs|css|svg)$/.test(name) ? [path] : [];
  });
}

describe("the website carries no design value of its own", () => {
  const files = [...sources(SRC), join(WEB, "tailwind.config.mjs")];

  it("reads the whole source tree, so a clean answer means it was looked at", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("layout.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("components.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("globals.css"))).toBe(true);
  });

  it("finds no colour, radius, shadow, font or arbitrary design value", () => {
    const found = files.flatMap((f) => violations(relative(WEB, f), readFileSync(f, "utf8")));
    expect(found, "take the value from the theme's tokens or the component kit").toEqual([]);
  });
});

describe("PROBES: each rule catches its shape and nothing else", () => {
  it("catches a planted value of every shape", () => {
    for (const [file, planted] of <[string, string][]>[
      ["x.tsx", `const accent = "#0e6fb8"`],
      ["x.tsx", `background: rgba(0, 0, 0, .3)`],
      ["x.tsx", `className="text-white"`],
      ["x.tsx", `className="bg-black/30"`],
      ["x.tsx", `className="bg-gray-100"`],
      ["x.tsx", `className="hover:text-red-500"`],
      ["x.tsx", `className="border-slate-300"`],
      ["x.css", `a { color: white; }`],
      ["x.svg", `<rect width="32" height="32" fill="white" />`],
      ["x.tsx", `<path stroke="red" />`],
      ["x.tsx", `style={{ color: "white" }}`],
      ["x.tsx", `className="rounded-2xl border"`],
      ["x.tsx", `className="rounded-t-xl"`],
      ["x.tsx", `className="rounded-md"`],
      ["x.tsx", `className="rounded-sm"`],
      ["x.tsx", `className="rounded p-1"`],
      ["x.tsx", `className="shadow-2xl"`],
      ["x.tsx", `className="hover:shadow"`],
      ["x.tsx", `className="drop-shadow-md"`],
      ["x.tsx", `className="font-serif"`],
      ["x.css", `body { font-family: Georgia, serif; }`],
      ["x.tsx", `style={{ fontFamily: "Inter" }}`],
      ["x.tsx", `className="text-[13px]"`],
      ["x.tsx", `className="shadow-[0_0_4px_red]"`],
    ]) {
      expect(violations(file, planted), planted).toHaveLength(1);
    }
  });

  it("PLANTED INNOCENT: tokens, anchors and layout values pass", () => {
    for (const [file, innocent] of <[string, string][]>[
      ["x.tsx", `href="#main"`],
      ["x.tsx", `className="rounded-card rounded-btn rounded-input rounded-dialog rounded-full focus:rounded-btn"`],
      ["x.tsx", `className="text-onPrimary bg-primary-600 border-border text-textMain text-neutral-500 bg-accent-50"`],
      ["x.tsx", `className="[overflow-wrap:anywhere] grid-cols-[1fr_auto_auto] max-w-3xl"`],
      ["x.tsx", `className="text-micro text-xs md:text-6xl"`],
      ["x.tsx", `className="shadow-md shadow-none focus-visible:shadow-focus"`],
      ["x.tsx", `className="font-mono font-sans font-display font-medium"`],
      ["x.svg", `<path fill="currentColor" stroke="none" />`],
      ["x.svg", `<rect fill="url(#grad)" />`],
      ["x.tsx", `<Badge color="primary" size="sm">`],
      ["x.ts", `interface Props { color: string; }`],
      ["x.css", `a { color: var(--color-textMain); box-shadow: var(--shadow-md); }`],
    ]) {
      expect(violations(file, innocent), innocent).toEqual([]);
    }
  });
});
