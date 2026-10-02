import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionAction, SUPPORTED_LANGUAGES } from "@digitaplatform/shared";
import { findMissingKeys, readBundle } from "@digitaplatform/shared/i18n-node";
import { DEFAULT_LANGUAGES } from "../src/core/setup/seed-languages.js";
import { PermissionDeniedError } from "../src/core/permissions/permission-checker.js";

/**
 * The calls whose first literal argument is a key: a text the code translates, and the code an
 * engine error carries, which an EngineError subclass passes to `super` or a throw site to the class.
 */
const KEY_CALLS = ["t", "super", "PermissionDeniedError", "EngineError", "DocStatusError", "FieldValueError", "BadRequestError", "MalformedFilterValueError"];

// The logger reads the real env; a test below imports that env itself, on purpose.
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

// vitest.config.ts stops the run without it.
const translationsDir = process.env["TRANSLATIONS_DIR"]!;
const texts = readBundle(translationsDir);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the engine's texts in TRANSLATIONS_DIR", () => {
  // Code and texts are versioned apart: every literal key of a t() or tPlural() call in the code
  // must be in this build's folder. The engine names most message keys otherwise, as
  // ctx.success("doc_saved") or { text: "…" } in an error response, and those are not seen.
  it("finds every literal key of the code in en.json, error codes included", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    expect(findMissingKeys(src, texts.en!, KEY_CALLS)).toEqual([]);
  });

  it("goes red on an error code en.json lacks (#24)", () => {
    const planted = mkdtempSync(join(tmpdir(), "engine-error-codes-"));
    try {
      writeFileSync(
        join(planted, "planted.ts"),
        'class A extends EngineError { constructor() { super("planted_missing_code", {}, 404, "NOT_FOUND"); } }\n' +
          'throw new PermissionDeniedError("planted_missing_refusal", {});\n',
      );
      expect(findMissingKeys(planted, texts.en!, KEY_CALLS)).toEqual([
        "planted.ts:1 planted_missing_code",
        "planted.ts:2 planted_missing_refusal",
      ]);
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }
  });

  it("holds a code of its own for every refused action of a permission row (#24)", () => {
    const codes = Object.values(PermissionAction).map((action) => PermissionDeniedError.forAction("Item", action).code);
    // The fallback is for an action no permission row names, so a row's action may never fall to it.
    expect(codes.filter((code) => code === "permission_denied_doc" || !Object.hasOwn(texts.en!, code))).toEqual([]);
    expect(new Set(codes).size).toBe(Object.values(PermissionAction).length);
  });

  it("are what the engine's translator reads, in every supported language", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    const { loadEngineI18n } = await import("../src/i18n.js");
    const i18n = loadEngineI18n();
    expect(i18n.supported).toEqual([...SUPPORTED_LANGUAGES]);
    for (const language of SUPPORTED_LANGUAGES) {
      expect(i18n.t("doc_saved", { doctype: "Item", name: "A-1" }, language)).toBe(
        texts[language]!["doc_saved"]!.replace("{doctype}", "Item").replace("{name}", "A-1"),
      );
    }
  });

  it("cover exactly the languages a tenant starts with", () => {
    expect(DEFAULT_LANGUAGES.map((language) => language._id).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });
});

describe("the engine's settings", () => {
  it("refuse to load without TRANSLATIONS_DIR, naming it", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://localhost:27017/test");
    vi.stubEnv("TRANSLATIONS_DIR", "");
    await expect(import("../src/core/config/env.js")).rejects.toThrow(
      "Missing required environment variable: TRANSLATIONS_DIR",
    );
  });
});
