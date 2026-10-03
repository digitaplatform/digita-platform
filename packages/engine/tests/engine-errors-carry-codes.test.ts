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
  "app.ts",
  "core/api/admin-reload-definitions-router.ts",
  "core/api/http-options.ts",
  "core/api/import-export-router.ts",
  "core/api/list-query.ts",
  "core/api/public-router.ts",
  "core/api/resource-router.ts",
  "core/api/revalidate-notifier.ts",
  "core/api/search-router.ts",
  "core/config/db-names.ts",
  "core/config/env.ts",
  "core/database/app-db-discovery.ts",
  "core/database/filter-builder.ts",
  "core/database/mongodb-service.ts",
  "core/document/docstatus-engine.ts",
  "core/document/document-service.ts",
  "core/document/naming-service.ts",
  "core/entity/field-types.ts",
  "core/entity/password-cipher.ts",
  "core/import-export/bk-resolver.ts",
  "core/import-export/csv-codec.ts",
  "core/import-export/import-service.ts",
  "core/period/period-close-validator.ts",
  "core/setup/reseed-app-data.ts",
  "core/setup/seed-app-data.ts",
  "core/setup/seed-data-translations.ts",
  "core/snapshot/snapshot-resolver.ts",
  "core/storage/local-storage.ts",
  "core/storage/s3-storage.ts",
  "core/storage/storage-factory.ts",
  "core/storage/storage-port.ts",
  "core/view/param-resolver.ts",
  "core/view/view-engine.ts",
  "core/view/view-registry.ts",
  "core/workflow/workflow-engine.ts",
  "i18n.ts",
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
    // A code is one word, so a first argument with a space is a sentence, also on the next line.
    [/\bsuper\(\s*(`[^`]*\s[^`]*`|"[^"]*\s[^"]*"|'[^']*\s[^']*')/g, "super with a sentence"],
    [/\bnew \w+Error\(\s*(`[^`]*\s[^`]*`|"[^"]*\s[^"]*"|'[^']*\s[^']*')/g, "new error with a sentence"],
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
          "throw new BadRequestError(`${param} must be a number`);",
          "throw new SnapshotMissingTargetError(`${entity}.${field}`, target);",
          'class KeptError extends EngineError { constructor(name: string) { super("kept", { name }, 409, "KEPT"); } }',
        ].join("\n"),
      );
      expect(findEnglishErrors(planted, relative(dir, planted))).toEqual([
        "planted.ts:1 new Error",
        "planted.ts:2 extends Error",
        "planted.ts:3 super with a sentence",
        "planted.ts:4 super with a sentence",
        "planted.ts:5 super with a sentence",
        "planted.ts:7 new error with a sentence",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
