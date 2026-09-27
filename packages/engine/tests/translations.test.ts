import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LANGUAGES } from "@digitaplatform/shared";
import { findMissingKeys, readBundle } from "@digitaplatform/shared/i18n-node";
import { DEFAULT_LANGUAGES } from "../src/core/setup/seed-languages.js";

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
  it("finds every literal key of the code in en.json", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    expect(findMissingKeys(src, texts.en!)).toEqual([]);
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
