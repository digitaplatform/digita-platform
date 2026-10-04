import type { MongoDBService } from "../database/mongodb-service.js";
import { DIGITA } from "@digitaplatform/shared";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("locale-resolver");

export interface ResolvedLocale {
  code: string;
  fallback: string;
  direction: "ltr" | "rtl";
  /** BCP-47 formatting locale (e.g. "de-CH") — drives Intl number/date/currency
   *  formatting on the frontend. Region-aware, independent of the UI language. */
  format_locale: string;
  /** Whether format_locale is the person's explicit preference rather than following code. */
  has_format_locale_preference?: boolean;
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

/** The verified caller as the locale needs it; every other token claim rides along. */
export interface LocaleUser {
  email?: string;
  language?: string;
  [claim: string]: unknown;
}

/**
 * A demo session's format and timezone, from its token claims: every visitor signs in as the
 * same demo user, so a preference stored on that user would be every visitor's. The language
 * already comes from the session through the token's language claim.
 */
function sessionLocalePref(user: LocaleUser): UserLocalePref {
  return { format_locale: trimmed(user["format_locale"]), timezone: trimmed(user["timezone"]) };
}

export class LocaleResolver {
  private enabledLanguages: Set<string> | null = null;
  private languageCache: Map<string, Record<string, unknown>> = new Map();
  private defaultLanguage: string = env.BOOTSTRAP_LOCALE;
  private fallbackLanguage: string = env.TRANSLATION_FALLBACK_LOCALE;
  // Setting.timezone declares "UTC" as its default; a singleton not seeded yet reads as that default.
  private timeZone = "UTC";

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
      this.timeZone = (s["timezone"] as string) || "UTC";
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
   * A demo session (`demo: true` claim) never reads the shared user's preference.
   */
  async resolve(user: LocaleUser | undefined, acceptLanguageHeader?: string): Promise<ResolvedLocale> {
    const pref = !user?.email
      ? null
      : user["demo"] === true
        ? sessionLocalePref(user)
        : await this.getUserLocalePref(user.email);
    const language = await this.pickLanguage(pref?.language, user?.language, acceptLanguageHeader);
    const base = await this.buildLocale(language);
    return {
      ...base,
      format_locale: trimmed(pref?.format_locale) ?? language,
      has_format_locale_preference: Boolean(trimmed(pref?.format_locale)),
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
    for (const requested of [prefLanguage, userLanguage]) {
      if (!requested) continue;
      const exact = [...enabled].find((code) => code.toLowerCase() === requested.toLowerCase());
      if (exact) return exact;
    }
    if (acceptLanguageHeader) {
      for (const lang of this.parseAcceptLanguage(acceptLanguageHeader)) {
        const exact = [...enabled].find((code) => code.toLowerCase() === lang);
        if (exact) return exact;
        const base = lang.split("-")[0]!;
        if (enabled.has(base)) return base;
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

  getFallbackLanguage(): string {
    return this.fallbackLanguage;
  }

  /** The tenant's time zone (Setting.timezone, IANA), whose calendar day is the tenant's "today". */
  getTimeZone(): string {
    return this.timeZone;
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
   * (see affects()), so a newly enabled language / changed default / changed direction
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
      format_locale: code,
      timezone: null,
    };
  }

  private languageToLocale(code: string, data: Record<string, unknown>): ResolvedLocale {
    return {
      code,
      fallback: this.fallbackLanguage,
      direction: (data["direction"] as "ltr" | "rtl") ?? "ltr",
      format_locale: code,
      timezone: null,
    };
  }

  private parseAcceptLanguage(header: string): string[] {
    return header
      .split(",")
      .map((part) => {
        const [lang = "", ...params] = part.trim().split(";");
        const quality = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));
        return { lang: lang.trim().toLowerCase(), q: quality ? Number(quality.slice(2)) : 1 };
      })
      .filter((item) => item.lang && item.q > 0)
      .sort((a, b) => b.q - a.q)
      .map((item) => item.lang);
  }
}
