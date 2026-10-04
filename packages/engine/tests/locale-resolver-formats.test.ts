import { describe, it, expect, expectTypeOf, vi } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: { BOOTSTRAP_LOCALE: "en", TRANSLATION_FALLBACK_LOCALE: "en" },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { readFileSync } from "node:fs";
import { LocaleResolver, type ResolvedLocale } from "../src/core/i18n/locale-resolver.js";
import { DEFAULT_LANGUAGES } from "../src/core/setup/seed-languages.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

/**
 * The app formats dates, times and numbers by the locale's format_locale through Intl, and
 * nothing in it reads the format fields of a Language row: an administrator who set
 * date_format or first_day_of_week saw no screen change. The locale the engine resolves for
 * /boot carries none of them, so the app is told no format it ignores, and a Language row
 * offers none, so an administrator is not given a setting that does nothing.
 */

const FORMAT_FIELDS = ["date_format", "time_format", "number_format", "first_day_of_week"] as const;

function resolverWithLanguages(rows: Record<string, Record<string, unknown>>): LocaleResolver {
  const db = {
    findOne: async (collection: string, id: string) => (collection === "Language" ? (rows[id] ?? null) : null),
    find: async (collection: string) => (collection === "Language" ? [{ _id: "de" }, { _id: "fr" }] : []),
    findOneByFilter: async () => null,
  } as unknown as MongoDBService;
  return new LocaleResolver(db);
}

describe("the locale the engine resolves", () => {
  it("names no Language format field", () => {
    expectTypeOf<ResolvedLocale>().not.toHaveProperty("date_format");
    expectTypeOf<ResolvedLocale>().not.toHaveProperty("time_format");
    expectTypeOf<ResolvedLocale>().not.toHaveProperty("number_format");
    expectTypeOf<ResolvedLocale>().not.toHaveProperty("first_day_of_week");
  });

  it("carries no format field of a Language row that sets them, and formats by the language", async () => {
    const resolver = resolverWithLanguages({
      de: {
        _id: "de",
        direction: "ltr",
        date_format: "DD.MM.YYYY",
        time_format: "HH:mm",
        number_format: "#.###,##",
        first_day_of_week: "Sunday",
      },
    });
    await resolver.initialize();

    const locale = await resolver.resolve({ language: "de" });

    for (const field of FORMAT_FIELDS) expect(locale).not.toHaveProperty(field);
    expect(locale).toEqual({ code: "de", fallback: "en", direction: "ltr", format_locale: "de", has_format_locale_preference: false, timezone: null });
  });

  it("carries no format field for a language without a row of its own", async () => {
    const resolver = resolverWithLanguages({});
    await resolver.initialize();

    const locale = await resolver.resolve({ language: "fr" });

    for (const field of FORMAT_FIELDS) expect(locale).not.toHaveProperty(field);
    expect(locale).toEqual({ code: "fr", fallback: "en", direction: "ltr", format_locale: "fr", has_format_locale_preference: false, timezone: null });
  });
});

describe("a Language row", () => {
  it("offers no format field on its form, and none is seeded", () => {
    const entity = JSON.parse(
      readFileSync(new URL("../src/entities/Language.entity.json", import.meta.url), "utf8"),
    ) as { fields: { fieldname: string }[] };
    const fieldnames = entity.fields.map((field) => field.fieldname);
    expect(fieldnames).toEqual(expect.arrayContaining(["code", "direction", "flag_emoji"]));
    for (const field of FORMAT_FIELDS) expect(fieldnames).not.toContain(field);
    expect(DEFAULT_LANGUAGES.length).toBeGreaterThan(0);
    for (const language of DEFAULT_LANGUAGES) for (const field of FORMAT_FIELDS) expect(language).not.toHaveProperty(field);
  });
});
