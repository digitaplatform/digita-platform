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
    const loc = await r.resolve({ email: "user@example.com", language: "de" });
    expect(loc.code).toBe("de"); // UI language
    expect(loc.format_locale).toBe("de-CH"); // Swiss formatting
    expect(loc.timezone).toBe("Europe/Zurich");
    expect(loc.has_format_locale_preference).toBe(true);
  });

  it("lets the preference override the UI language (it UI, CH formatting)", async () => {
    const pref = { value: JSON.stringify({ language: "it", format_locale: "de-CH" }) };
    const r = await build(pref);
    const loc = await r.resolve({ email: "user@example.com", language: "de" });
    expect(loc.code).toBe("it");
    expect(loc.format_locale).toBe("de-CH");
  });

  it("defaults format_locale to the language code and timezone to null without a preference", async () => {
    const r = await build(null);
    const loc = await r.resolve({ email: "user@example.com", language: "de" });
    expect(loc.format_locale).toBe("de");
    expect(loc.timezone).toBeNull();
    expect(loc.has_format_locale_preference).toBe(false);
  });

  it("survives a malformed preference value (no throw, falls back)", async () => {
    const r = await build({ value: "{not json" });
    const loc = await r.resolve({ email: "user@example.com", language: "de" });
    expect(loc.code).toBe("de");
    expect(loc.format_locale).toBe("de");
  });

  it("ignores an unknown preference language (falls back to token)", async () => {
    const pref = { value: JSON.stringify({ language: "zz" }) };
    const r = await build(pref);
    const loc = await r.resolve({ email: "user@example.com", language: "de" });
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
  it("keeps es-MX for tokens and weighted mixed-case headers, defaulting formats to that tag", async () => {
    const state = { langs: ["en", "es", "es-MX"] };
    const r = new LocaleResolver(makeMutableDb(state));
    await r.initialize();
    expect(await r.resolve({ language: "es-MX" })).toMatchObject({ code: "es-MX", format_locale: "es-MX" });
    expect(await r.resolve(undefined, "ES-mx;Q=0.9,en;q=0.5")).toMatchObject({ code: "es-MX", format_locale: "es-MX" });
    expect(await r.resolveLanguage(undefined, "es-MX ;q=1,en;q=0.5")).toBe("es-MX");
    expect(await r.resolveLanguage(undefined, "es-MX;q=0,es;q=0.5")).toBe("es");
    expect(await r.resolveLanguage(undefined, "en;q=0.9,es-MX;q=0.5")).toBe("en");
    expect(await r.resolveLanguage(undefined, "es-ES")).toBe("es");
    state.langs = ["en", "es"];
    await r.refresh();
    expect(await r.resolveLanguage(undefined, "es-MX")).toBe("es");
  });

  it('retains a base-language header with whitespace before its quality parameter', async () => {
    const r = new LocaleResolver(makeMutableDb({ langs: ['en', 'de'] }));
    await r.initialize();
    expect(await r.resolveLanguage(undefined, 'de ;q=1,en;q=0.5')).toBe('de');
  });

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

describe("LocaleResolver — the tenant's time zone", () => {
  const withSetting = (setting: Record<string, unknown> | null) =>
    ({
      findOne: async (coll: string) => (coll === "Setting" ? setting : null),
      find: async () => [],
      findOneByFilter: async () => null,
    }) as unknown as MongoDBService;

  it("is Setting.timezone, and follows a changed setting on refresh", async () => {
    const setting: Record<string, unknown> = { timezone: "Europe/Zurich" };
    const r = new LocaleResolver(withSetting(setting));
    await r.initialize();
    expect(r.getTimeZone()).toBe("Europe/Zurich");
    setting["timezone"] = "America/New_York";
    await r.refresh();
    expect(r.getTimeZone()).toBe("America/New_York");
  });

  it("is UTC, the setting's declared default, while no Setting is stored", async () => {
    const r = new LocaleResolver(withSetting(null));
    await r.initialize();
    expect(r.getTimeZone()).toBe("UTC");
  });
});
