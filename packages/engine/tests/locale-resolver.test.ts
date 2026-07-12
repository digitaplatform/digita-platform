import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/core/config/env.js", () => ({
  env: { BOOTSTRAP_LOCALE: "en", TRANSLATION_FALLBACK_LOCALE: "en" },
}));
vi.mock("../src/core/logging/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }),
}));

import { LocaleResolver } from "../src/core/i18n/locale-resolver.js";
import type { MongoDBService } from "../src/core/database/mongodb-service.js";

function makeDb(prefRow: unknown): MongoDBService {
  return {
    findOne: async (coll: string) => {
      if (coll === "Setting") return null; // use env defaults
      if (coll === "Language")
        return { direction: "ltr", date_format: "DD.MM.YYYY", time_format: "HH:mm", number_format: "#.###,##", first_day_of_week: "Monday" };
      return null;
    },
    find: async (coll: string) =>
      coll === "Language" ? [{ _id: "de" }, { _id: "en" }, { _id: "it" }] : [],
    findOneByFilter: async (coll: string, filter: Record<string, unknown>) =>
      coll === "UserPreference" && filter["pref_key"] === "locale" ? prefRow : null,
  } as unknown as MongoDBService;
}

async function build(prefRow: unknown): Promise<LocaleResolver> {
  const r = new LocaleResolver(makeDb(prefRow));
  await r.initialize();
  return r;
}

describe("LocaleResolver — region/timezone via UserPreference", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies format_locale + timezone from the user's locale preference", async () => {
    const pref = { value: JSON.stringify({ format_locale: "de-CH", timezone: "Europe/Zurich" }) };
    const r = await build(pref);
    const loc = await r.resolve("user@example.com", "de", undefined);
    expect(loc.code).toBe("de"); // UI language
    expect(loc.format_locale).toBe("de-CH"); // Swiss formatting
    expect(loc.timezone).toBe("Europe/Zurich");
  });

  it("lets the preference override the UI language (it UI, CH formatting)", async () => {
    const pref = { value: JSON.stringify({ language: "it", format_locale: "de-CH" }) };
    const r = await build(pref);
    const loc = await r.resolve("user@example.com", "de", undefined);
    expect(loc.code).toBe("it");
    expect(loc.format_locale).toBe("de-CH");
  });

  it("defaults format_locale to the language code and timezone to null without a preference", async () => {
    const r = await build(null);
    const loc = await r.resolve("user@example.com", "de", undefined);
    expect(loc.format_locale).toBe("de");
    expect(loc.timezone).toBeNull();
  });

  it("survives a malformed preference value (no throw, falls back)", async () => {
    const r = await build({ value: "{not json" });
    const loc = await r.resolve("user@example.com", "de", undefined);
    expect(loc.code).toBe("de");
    expect(loc.format_locale).toBe("de");
  });

  it("ignores an unknown preference language (falls back to token)", async () => {
    const pref = { value: JSON.stringify({ language: "zz" }) };
    const r = await build(pref);
    const loc = await r.resolve("user@example.com", "de", undefined);
    expect(loc.code).toBe("de");
  });
});

function makeMutableDb(state: { langs: string[] }): MongoDBService {
  return {
    findOne: async (coll: string) =>
      coll === "Language"
        ? { direction: "ltr", date_format: "DD.MM.YYYY", time_format: "HH:mm", number_format: "#.###,##", first_day_of_week: "Monday" }
        : null,
    find: async (coll: string) => (coll === "Language" ? state.langs.map((_id) => ({ _id })) : []),
    findOneByFilter: async () => null,
  } as unknown as MongoDBService;
}

describe("LocaleResolver — cache invalidation (B2)", () => {
  it("affects() flags the settings singleton and the Language registry only", () => {
    const r = new LocaleResolver(makeMutableDb({ langs: ["en"] }));
    expect(r.affects("Setting")).toBe(true);
    expect(r.affects("Language")).toBe(true);
    expect(r.affects("Product")).toBe(false);
  });

  it("refresh() picks up a newly enabled language without an engine restart", async () => {
    const state = { langs: ["en", "de"] };
    const r = new LocaleResolver(makeMutableDb(state));
    await r.initialize();
    expect([...(await r.getEnabledLanguages())].sort()).toEqual(["de", "en"]);

    // Admin enables Turkish. Until the cache is invalidated it stays stale...
    state.langs = ["en", "de", "tr"];
    expect((await r.getEnabledLanguages()).has("tr")).toBe(false);

    // ...refresh() re-reads the Language registry → immediately visible.
    await r.refresh();
    expect((await r.getEnabledLanguages()).has("tr")).toBe(true);
  });
});
