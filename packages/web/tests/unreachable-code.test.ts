// Code nothing calls reads like an API to whoever looks for one: the renderer serves no route
// without a caller and keeps no formatter without one.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { setSiteEnv } from "./site-env";

// The registry reaches the server config through the media block.
vi.mock("server-only", () => ({}));
setSiteEnv();

const src = fileURLToPath(new URL("../src", import.meta.url));

/** The lines of a source file that are code: a comment that names a thing calls nothing. */
const codeLines = (text: string): string[] => text.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));

/** Who calls each route of the renderer: the file of this package that does, or the caller outside
 *  it. A route is added here with its caller, or not at all. */
type Caller = { file: string } | { outside: string };
const ROUTE_CALLERS: Record<string, Caller> = {
  contact: { file: "components/ContactSheet.tsx" },
  record: { file: "blocks/RecordFormFields.tsx" },
  revalidate: { outside: "the engine posts to the REVALIDATE_URL of its deployment after a save" },
};

/** The routes no caller reaches: one the list does not name, or whose file never mentions it in code. */
function routesWithoutCaller(routes: string[], callers: Record<string, Caller>, readCode: (file: string) => string[]): string[] {
  return routes.filter((route) => {
    const caller = callers[route];
    if (!caller) return true;
    return "file" in caller && !readCode(caller.file).some((line) => line.includes(`/api/${route}`));
  });
}

/** The exports of a module that no other source mentions in code. */
function exportsWithoutCaller(exported: string[], otherSources: string[]): string[] {
  const code = otherSources.flatMap(codeLines).join("\n");
  return exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(code));
}

const sourceFiles = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file)).map((file) => join(dir, file));

describe("the routes of the renderer", () => {
  const routes = readdirSync(join(src, "app/api"), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith("/route.ts"))
    .map((file) => file.slice(0, -"/route.ts".length));
  const readCode = (file: string) => codeLines(readFileSync(join(src, file), "utf8"));

  it("each have a caller", () => {
    expect(routesWithoutCaller(routes, ROUTE_CALLERS, readCode)).toEqual([]);
  });

  it("PLANTED DEFECT: the check names a route the list does not know, and one whose caller never mentions it", () => {
    const code = (file: string) => codeLines(file === "a.tsx" ? 'await fetch("/api/a");' : "// posts to /api/b");
    const callers = { a: { file: "a.tsx" }, b: { file: "b.tsx" } };
    expect(routesWithoutCaller(["a", "b", "c"], callers, code)).toEqual(["b", "c"]);
  });

  it("PLANTED INNOCENT: the check passes a route with a file that calls it and one with a caller outside", () => {
    const callers = { a: { file: "a.tsx" }, b: { outside: "the engine" } };
    expect(routesWithoutCaller(["a", "b"], callers, () => codeLines('await fetch("/api/a");'))).toEqual([]);
  });
});

describe("the exports of lib/format.ts", () => {
  const file = join(src, "lib/format.ts");
  const exported = [...readFileSync(file, "utf8").matchAll(/^export function (\w+)/gm)].map((match) => match[1]!);
  const others = sourceFiles(src).filter((candidate) => candidate !== file).map((candidate) => readFileSync(candidate, "utf8"));

  it("each have a caller", () => {
    expect(exported.length).toBeGreaterThan(0);
    expect(exportsWithoutCaller(exported, others)).toEqual([]);
  });

  it("PLANTED DEFECT: the check names an export that only a comment mentions", () => {
    expect(exportsWithoutCaller(["formatA", "formatB"], ["formatA(1);", "// formatB would go here"])).toEqual(["formatB"]);
  });

  it("PLANTED INNOCENT: the check passes an export a file calls, and ignores a longer name that contains it", () => {
    expect(exportsWithoutCaller(["format"], ["format(1);"])).toEqual([]);
    expect(exportsWithoutCaller(["format"], ["formatCurrency(1);"])).toEqual(["format"]);
  });
});

describe("the block and plugin manifests", () => {
  // The renderer reads a manifest's type or id and its component; its name, description and
  // category tell a reader of the source what it is. A prop schema no code checks drifts from
  // what the block reads and reads like a contract that holds.
  it("declare no prop schema", async () => {
    const { BLOCK_MANIFESTS } = await import("../src/blocks/registry");
    const { PLUGIN_MANIFESTS } = await import("../src/plugins");
    const withSchema = [...BLOCK_MANIFESTS.map((m) => ({ key: m.type, m })), ...PLUGIN_MANIFESTS.map((m) => ({ key: m.id, m }))]
      .filter(({ m }) => "props" in m)
      .map(({ key }) => key);
    expect(withSchema).toEqual([]);
  });
});
