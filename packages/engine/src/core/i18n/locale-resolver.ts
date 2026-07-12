import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("locale-resolver");

export interface ResolvedLocale {
  code: string;
  fallback: string;
  direction: "ltr" | "rtl";
  date_format: string;
  time_format: string;
  number_format: string;
  first_day_of_week: string;
  /** BCP-47 formatting locale (e.g. "de-CH") — drives Intl number/date/currency
   *  formatting on the frontend. Region-aware, independent of the UI language. */
  format_locale: string;
  /** IANA timezone for datetime display (e.g. "Europe/Zurich"), or null. */
  timezone: string | null;
}

/** Per-user locale preference, stored in the UserPreference KV store under the
 *  "locale" key (value = JSON). Lets a user choose, in their profile, a region
 *  format (de-CH vs de-DE) + timezone independent of the UI language. */
interface UserLocalePref {
  language?: string;
  format_locale?: string;
  timezone?: string;
}
const trimmed = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

export class LocaleResolver {
  private enabledLanguages: Set<string> | null = null;
  private languageCache: Map<string, Record<string, unknown>> = new Map();
  private defaultLanguage: string = env.BOOTSTRAP_LOCALE;
  private fallbackLanguage: string = env.TRANSLATION_FALLBACK_LOCALE;

  constructor(private db: MongoDBService) {}

  /**
   * Initialize from database (SystemSettings + Language collection).
   */
  async initialize(): Promise<void> {
    // Load Settings
    const settings = await this.db.findOne(DIGITA.COLLECTIONS.SETTING, "settings", DIGITA.DATABASES.CORE);
    if (settings) {
      const s = settings as Record<string, unknown>;
      this.defaultLanguage = (s["default_language"] as string) ?? env.BOOTSTRAP_LOCALE;
      this.fallbackLanguage = (s["fallback_language"] as string) ?? env.TRANSLATION_FALLBACK_LOCALE;
    }

    // Load enabled languages
    await this.refreshEnabledLanguages();

    log.info(
      {
        default: this.defaultLanguage,
        fallback: this.fallbackLanguage,
        enabled: Array.from(this.enabledLanguages ?? []),
      },
      "Locale resolver initialized",
    );
  }

  /**
   * Resolve locale for a request. Language priority: stored UserPreference →
   * token language → Accept-Language → system default. On top, the per-user
   * preference supplies the BCP-47 format_locale (region) + timezone, which are
   * independent of the UI language (so "German UI, Swiss formatting" works).
   */
  async resolve(
    userEmail?: string,
    userLanguage?: string,
    acceptLanguageHeader?: string,
  ): Promise<ResolvedLocale> {
    const pref = userEmail ? await this.getUserLocalePref(userEmail) : null;
    const language = await this.pickLanguage(pref?.language, userLanguage, acceptLanguageHeader);
    const base = await this.buildLocale(language);
    return {
      ...base,
      format_locale: trimmed(pref?.format_locale) ?? language,
      timezone: trimmed(pref?.timezone) ?? null,
    };
  }

  /**
   * Cheap language-code resolution for the read path: token language →
   * Accept-Language → default, enabled-aware. Skips the UserPreference lookup
   * (data-value translation only needs the language, and the language pref is
   * already reflected in the token/Accept-Language) so it adds no per-read DB call.
   */
  async resolveLanguage(userLanguage?: string, acceptLanguageHeader?: string): Promise<string> {
    return this.pickLanguage(undefined, userLanguage, acceptLanguageHeader);
  }

  /** Language code by priority (enabled-aware): pref → token → Accept-Language → default. */
  private async pickLanguage(
    prefLanguage?: string,
    userLanguage?: string,
    acceptLanguageHeader?: string,
  ): Promise<string> {
    const enabled = await this.getEnabledLanguages();
    if (prefLanguage && enabled.has(prefLanguage)) return prefLanguage;
    if (userLanguage && enabled.has(userLanguage)) return userLanguage;
    if (acceptLanguageHeader) {
      for (const lang of this.parseAcceptLanguage(acceptLanguageHeader)) {
        if (enabled.has(lang)) return lang;
      }
    }
    return this.defaultLanguage;
  }

  /** Read the user's "locale" preference from the UserPreference KV store. Never
   *  throws (missing collection / malformed JSON → no preference). */
  private async getUserLocalePref(email: string): Promise<UserLocalePref | null> {
    try {
      const row = await this.db.findOneByFilter(
        DIGITA.COLLECTIONS.USER_PREFERENCE,
        { owner: email, pref_key: "locale" },
        DIGITA.DATABASES.CORE,
      );
      const raw = (row as Record<string, unknown> | null)?.["value"];
      if (typeof raw !== "string" || !raw.trim()) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        language: trimmed(parsed["language"]),
        format_locale: trimmed(parsed["format_locale"]),
        timezone: trimmed(parsed["timezone"]),
      };
    } catch {
      return null;
    }
  }

  async getEnabledLanguages(): Promise<Set<string>> {
    if (!this.enabledLanguages) {
      await this.refreshEnabledLanguages();
    }
    return this.enabledLanguages!;
  }

  getDefaultLanguage(): string {
    return this.defaultLanguage;
  }

  getFallbackLanguage(): string {
    return this.fallbackLanguage;
  }

  /**
   * True when a write to this doctype invalidates resolved-locale state — the
   * settings singleton or the Language registry. Keeps the knowledge of WHICH
   * collections feed the resolver inside the resolver (the write path just asks),
   * rather than hardcoding these names in the router.
   */
  affects(doctype: string): boolean {
    return doctype === DIGITA.COLLECTIONS.SETTING || doctype === DIGITA.COLLECTIONS.LANGUAGE;
  }

  /**
   * Drop all cached locale state and re-read SystemSettings + the Language
   * collection. Wired to fire when the settings singleton or a Language row changes
   * (see affects()), so a newly enabled language / changed default / changed format
   * takes effect immediately — previously the cache held until an engine restart.
   */
  async refresh(): Promise<void> {
    this.languageCache.clear();
    this.enabledLanguages = null;
    await this.initialize();
  }

  private async refreshEnabledLanguages(): Promise<void> {
    try {
      const langs = await this.db.find(
        DIGITA.COLLECTIONS.LANGUAGE,
        {
          filters: [{ enabled: true }],
          fields: ["_id"],
        },
        DIGITA.DATABASES.CORE,
      );
      this.enabledLanguages = new Set(
        (langs as Record<string, unknown>[]).map((l) => l["_id"] as string),
      );
    } catch {
      // Language collection may not exist yet during first run
      this.enabledLanguages = new Set([env.BOOTSTRAP_LOCALE]);
    }
  }

  private async buildLocale(code: string): Promise<ResolvedLocale> {
    // Check cache
    if (this.languageCache.has(code)) {
      return this.languageToLocale(code, this.languageCache.get(code)!);
    }

    const language = await this.db.findOne(DIGITA.COLLECTIONS.LANGUAGE, code, DIGITA.DATABASES.CORE);
    if (language) {
      const langData = language as Record<string, unknown>;
      this.languageCache.set(code, langData);
      return this.languageToLocale(code, langData);
    }

    // Fallback defaults (format_locale/timezone overridden in resolve()).
    return {
      code,
      fallback: this.fallbackLanguage,
      direction: "ltr",
      date_format: "YYYY-MM-DD",
      time_format: "HH:mm",
      number_format: "#,###.##",
      first_day_of_week: "Monday",
      format_locale: code,
      timezone: null,
    };
  }

  private languageToLocale(code: string, data: Record<string, unknown>): ResolvedLocale {
    return {
      code,
      fallback: this.fallbackLanguage,
      direction: (data["direction"] as "ltr" | "rtl") ?? "ltr",
      date_format: (data["date_format"] as string) ?? "YYYY-MM-DD",
      time_format: (data["time_format"] as string) ?? "HH:mm",
      number_format: (data["number_format"] as string) ?? "#,###.##",
      first_day_of_week: (data["first_day_of_week"] as string) ?? "Monday",
      format_locale: code,
      timezone: null,
    };
  }

  private parseAcceptLanguage(header: string): string[] {
    return header
      .split(",")
      .map((part) => {
        const [lang, qPart] = part.trim().split(";");
        const q = qPart ? parseFloat(qPart.replace("q=", "")) : 1;
        return { lang: lang!.trim().split("-")[0]!, q };
      })
      .sort((a, b) => b.q - a.q)
      .map((item) => item.lang);
  }
}
