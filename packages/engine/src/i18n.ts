import { createTranslator, type Translator } from "@digitaplatform/shared";
import { readBundle } from "@digitaplatform/shared/i18n-node";
import { env } from "./core/config/env.js";
import { createLogger } from "./core/logging/logger.js";

const log = createLogger("i18n");

let translator: Translator | null = null;

/**
 * Static system-message i18n (doc_created, field_required, …) backed by the
 * shared in-memory translator — the SAME mechanism digita-auth uses. Loaded
 * once at boot from TRANSLATIONS_DIR; a missing or unreadable language file
 * stops the boot, naming it. These are code-fixed messages.
 *
 * Admin-editable / per-document data translations stay in TranslationService
 * (MongoDB). Clean split: static → here, runtime → TranslationService.
 */
export function loadEngineI18n(): Translator {
  const bundle = readBundle(env.TRANSLATIONS_DIR);
  translator = createTranslator(bundle, env.TRANSLATION_FALLBACK_LOCALE);
  log.info({ dir: env.TRANSLATIONS_DIR, locales: Object.keys(bundle) }, "engine i18n loaded");
  return translator;
}

/** The English text of a code for a log entry, or nothing before the catalog is loaded, when a
 *  log entry carries the code and its params alone. */
export function englishText(code: string, params?: Record<string, string>): string | undefined {
  return translator?.t(code, params, "en");
}

/** The language of the engine's texts for a request: the user's own where the engine has texts in
 *  it, else the best match of the request's Accept-Language. */
export function messageLocale(userLanguage: string | undefined, acceptLanguage: string | undefined): string {
  const i18n = engineI18n();
  return userLanguage && i18n.supported.includes(userLanguage) ? userLanguage : i18n.resolveLocale(acceptLanguage);
}

/** The boot-loaded translator; throws until loadEngineI18n() has run. */
export function engineI18n(): Translator {
  if (!translator) throw new Error("engine i18n: loadEngineI18n() has not run");
  return translator;
}
