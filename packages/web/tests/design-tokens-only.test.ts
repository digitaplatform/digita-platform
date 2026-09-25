// The website takes its whole look from the app's theme and component kit: no colour, radius,
// shadow or font of its own. This scans every source file with designValueFindings, and proves
// each rule on a planted defect and on planted innocent neighbours — among them values split
// over lines, which a line-by-line check misjudges.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { designValueFindings } from "./design-values";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(WEB, "src");

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
    const found = files.flatMap((f) => designValueFindings(relative(WEB, f), readFileSync(f, "utf8")));
    expect(found, "take the value from the theme's tokens or the component kit").toEqual([]);
  });
});

describe("PROBES: each rule catches its shape and nothing else", () => {
  it("catches a planted value of every shape", () => {
    for (const [file, planted] of <[string, string][]>[
      ["x.tsx", `const accent = "#0e6fb8";`],
      ["x.tsx", `const scrim = { background: "Rgb(0, 0, 0)" };`],
      ["x.tsx", `const a = <p className="text-white" />;`],
      ["x.tsx", `const a = <p className="bg-black/30" />;`],
      ["x.tsx", `const a = <p className="bg-gray-100" />;`],
      ["x.tsx", `const a = <p className="hover:text-red-500" />;`],
      ["x.tsx", `const a = <p className="border-slate-300" />;`],
      ["x.tsx", `const a = <p className="bg-lightBlue-500" />;`],
      ["x.tsx", `const a = <p className={cn(\n  "p-2",\n  "text-white",\n)} />;`],
      ["x.css", `a { color: white; }`],
      ["x.css", `a {\n  border:\n    1px solid red;\n}`],
      ["x.css", `a { background: linear-gradient(red, blue); }`],
      ["x.svg", `<rect width="32" height="32" fill="white" />`],
      ["x.svg", `<path style="fill:white" d="M0 0h1" />`],
      ["x.tsx", `const a = <path stroke="red" />;`],
      ["x.tsx", `const a = <Heart color="red" />;`],
      ["x.tsx", `const a = <Heart color={urgent ? "red" : "blue"} />;`],
      ["x.tsx", `const a = <p style={{ color: "white" }} />;`],
      ["x.tsx", `const a = <p style={{\n  border:\n    "1px solid red",\n}} />;`],
      ["x.tsx", `const a = <p style={{ boxShadow: "0 0 4px red" }} />;`],
      ["x.tsx", `const a = <p style={{ textDecorationColor: "red" }} />;`],
      ["x.tsx", `const a = <p style={{ textDecoration: "underline wavy red" }} />;`],
      ["x.tsx", `const a = <meta name="theme-color" content="white" />;`],
      ["x.tsx", `export const viewport = { themeColor: "white" };`],
      ["x.tsx", `const a = <p className="focus:ring-2" />;`],
      ["x.tsx", `const a = <p className="[color:red]" />;`],
      ["x.tsx", `const a = <p className="[--tw-ring-color:red]" />;`],
      ["x.tsx", `const a = <p className="rounded-2xl border" />;`],
      ["x.tsx", `const a = <p className="rounded-t-xl" />;`],
      ["x.tsx", `const a = <p className="rounded-md" />;`],
      ["x.tsx", `const a = <p className="rounded-sm" />;`],
      ["x.tsx", `const a = <p className="rounded p-1" />;`],
      ["x.tsx", `const a = <p className="shadow-2xl" />;`],
      ["x.tsx", `const a = <p className="hover:shadow" />;`],
      ["x.tsx", `const a = <p className="drop-shadow-md" />;`],
      ["x.tsx", `const a = <p className="font-serif" />;`],
      ["x.css", `body { font-family: Georgia, serif; }`],
      ["x.tsx", `const a = <p style={{ fontFamily: "Inter" }} />;`],
      ["x.tsx", `const a = <p className="text-[13px]" />;`],
      ["x.tsx", `const a = <p className="shadow-[0_0_4px_red]" />;`],
    ]) {
      expect(designValueFindings(file, planted), planted).toHaveLength(1);
    }
  });

  it("PLANTED INNOCENT: tokens, anchors, layout values, comments, types and text pass", () => {
    for (const [file, innocent] of <[string, string][]>[
      ["x.tsx", `const a = <a href="#main">skip</a>;`],
      ["x.tsx", `const a = <p className="rounded-card rounded-btn rounded-input rounded-dialog rounded-full focus:rounded-btn" />;`],
      ["x.tsx", `const a = <p className="text-onPrimary bg-primary-600 border-border text-textMain text-neutral-500 bg-accent-50" />;`],
      ["x.tsx", `const a = <p className="[overflow-wrap:anywhere] grid-cols-[1fr_auto_auto] max-w-3xl" />;`],
      ["x.tsx", `const a = <p className="text-micro text-xs md:text-6xl" />;`],
      ["x.tsx", `const a = <p className="shadow-md shadow-none focus-visible:shadow-focus" />;`],
      ["x.tsx", `const a = <p className="font-mono font-sans font-display font-medium" />;`],
      ["x.tsx", `const a = <p className="focus:ring-0" />;`],
      ["x.tsx", `const a = <p className={cn(\n  "focus:ring-2",\n  "focus:ring-primary-500",\n)} />;`],
      ["x.tsx", `const a = <Badge color="primary" size="sm" />;`],
      ["x.tsx", `const label = "Red team";\n// a ring of rounded, gold corners\nconst ringBuffer = 1;`],
      ["x.ts", `interface Props { color: string; }\ntype Palette = { [color: string]: number };`],
      ["x.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>X: orange</title></svg>`],
      ["x.svg", `<path fill="currentColor" stroke="none" />`],
      ["x.svg", `<rect fill="url(#grad)" />`],
      ["x.css", `a:hover .gold-badge { color: var(--color-textMain); box-shadow: var(--shadow-md); }`],
      ["x.css", `.hero { background: url("/hero-tan.jpg"); }`],
      ["x.css", `body { font-family: var(--font-sans); }`],
      ["x.css", `@media (prefers-color-scheme: dark) { a { font-weight: 600; } }`],
    ]) {
      expect(designValueFindings(file, innocent), innocent).toEqual([]);
    }
  });
});
