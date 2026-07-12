import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guardrail: the engine system-message locales (doc_*, field_*, database_*,
 * bulk_* …) — translated server-side per request — must stay key-aligned across
 * all languages, with matching interpolation placeholders and no empty values.
 * Catches a message key added in code/en.json but missing in de/es/tr (raw key
 * would leak to the user) and placeholder drift (e.g. es entity_not_found that
 * had dropped its {doctype}).
 */

const LOCALES = ["en", "de", "es", "tr"] as const;
const DIR = fileURLToPath(new URL("../src/locales/", import.meta.url));

const placeholders = (s: string): string[] => [...new Set(s.match(/\{[a-zA-Z0-9_]+\}/g) ?? [])].sort();

const bundles = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(`${DIR}${l}.json`, "utf8")) as Record<string, string>]),
) as Record<(typeof LOCALES)[number], Record<string, string>>;

describe("engine locale coverage", () => {
  const en = bundles.en;
  const refKeys = Object.keys(en);

  it("en: is the non-empty reference (keys present, no empty values)", () => {
    expect(refKeys.length).toBeGreaterThan(0);
    expect(Object.entries(en).filter(([, v]) => !v || !v.trim()).map(([k]) => k)).toEqual([]);
  });

  for (const loc of LOCALES.filter((l) => l !== "en")) {
    const target = bundles[loc];

    it(`${loc}: no missing or extra keys vs en`, () => {
      expect(Object.keys(target).filter((k) => !(k in en))).toEqual([]); // extra
      expect(refKeys.filter((k) => !(k in target))).toEqual([]); // missing
    });

    it(`${loc}: interpolation placeholders match en`, () => {
      const mismatches = refKeys
        .filter((k) => k in target)
        .filter((k) => placeholders(en[k]!).join(",") !== placeholders(target[k]!).join(","))
        .map((k) => `${k}: en{${placeholders(en[k]!)}} ${loc}{${placeholders(target[k]!)}}`);
      expect(mismatches).toEqual([]);
    });

    it(`${loc}: no empty values`, () => {
      expect(Object.entries(target).filter(([, v]) => !v || !v.trim()).map(([k]) => k)).toEqual([]);
    });
  }
});
