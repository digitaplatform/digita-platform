import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src", import.meta.url));

/**
 * The files whose errors carry a code with params. Each step of moving the engine's errors to
 * `EngineError` adds its files; once every file of `src` holds, this list becomes all of it.
 */
const CHECKED_FILES = [
  "core/document/document-service.ts",
  "core/document/docstatus-engine.ts",
  "core/document/naming-service.ts",
  "core/entity/field-types.ts",
];

/**
 * Where a file raises an error a person would read in English: a plain `Error`, a class that
 * extends `Error` instead of `EngineError`, or a `super` call that passes a sentence for the code.
 */
function findEnglishErrors(path: string, name = path): string[] {
  const text = readFileSync(path, "utf-8");
  const shapes: Array<[RegExp, string]> = [
    [/\bnew Error\(/g, "new Error"],
    [/\bclass \w+ extends Error\b/g, "extends Error"],
    // A code is one word, so a template or a literal with a space is a sentence, also on the next line.
    [/\bsuper\(\s*(`|"[^"]*\s[^"]*"|'[^']*\s[^']*')/g, "super with a sentence"],
  ];
  return shapes
    .flatMap(([shape, what]) =>
      [...text.matchAll(shape)].map((match) => ({ line: text.slice(0, match.index).split("\n").length, what })),
    )
    .sort((a, b) => a.line - b.line)
    .map(({ line, what }) => `${name}:${line} ${what}`);
}

describe("the engine's errors", () => {
  it("carry a code with params in every checked file", () => {
    const found = CHECKED_FILES.flatMap((file) => findEnglishErrors(join(src, file), file));
    expect(found).toEqual([]);
  });

  it("go red on each planted English error and stay green on a planted EngineError", () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-error-guard-"));
    try {
      const planted = join(dir, "planted.ts");
      writeFileSync(
        planted,
        [
          'throw new Error("the document is gone");',
          "class GoneError extends Error {}",
          "class LateError extends EngineError { constructor(name: string) { super(`${name} came late`, {}, 409, \"LATE\"); } }",
          'class WideError extends EngineError { constructor() { super("the list is too wide", {}, 400, "WIDE"); } }',
          "class SplitError extends EngineError { constructor(name: string) { super(",
          "  `${name} was split`, {}, 409, \"SPLIT\"); } }",
          'class KeptError extends EngineError { constructor(name: string) { super("kept", { name }, 409, "KEPT"); } }',
        ].join("\n"),
      );
      expect(findEnglishErrors(planted, relative(dir, planted))).toEqual([
        "planted.ts:1 new Error",
        "planted.ts:2 extends Error",
        "planted.ts:3 super with a sentence",
        "planted.ts:4 super with a sentence",
        "planted.ts:5 super with a sentence",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
