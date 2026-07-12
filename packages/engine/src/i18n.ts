import { readdir, readFile } from "fs/promises";
import { join, basename } from "path";
import { createTranslator, type Translator, type LocaleBundle } from "@digitaplatform/shared";
import { env } from "./core/config/env.js";
import { createLogger } from "./core/logging/logger.js";

const log = createLogger("i18n");

let translator: Translator | null = null;

/**
 * Static system-message i18n (doc_created, field_required, …) backed by the
 * shared in-memory translator — the SAME mechanism digita-auth uses. Loaded
 * once at boot from the file locales. These are code-fixed messages.
 *
 * Admin-editable / per-document data translations stay in TranslationService
 * (MongoDB). Clean split: static → here, runtime → TranslationService.
 */
export async function loadEngineI18n(): Promise<Translator> {
  const bundle: LocaleBundle = {};
  try {
    const files = (await readdir(env.LOCALES_DIR)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const locale = basename(file, ".json");
      bundle[locale] = JSON.parse(await readFile(join(env.LOCALES_DIR, file), "utf-8")) as Record<
        string,
        string
      >;
    }
  } catch {
    log.warn({ dir: env.LOCALES_DIR }, "i18n locale files not found — messages fall back to keys");
  }
  translator = createTranslator(bundle, env.TRANSLATION_FALLBACK_LOCALE);
  log.info({ locales: Object.keys(bundle) }, "engine i18n loaded");
  return translator;
}

/** The boot-loaded translator. Falls back to an empty (key-returning) one if
 *  loadEngineI18n() hasn't run (e.g. a unit test that didn't boot). */
export function engineI18n(): Translator {
  if (!translator) translator = createTranslator({}, env.TRANSLATION_FALLBACK_LOCALE);
  return translator;
}
