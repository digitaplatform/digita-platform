import "server-only";
import { createTranslator, FALLBACK_LANGUAGE, type Translator } from "@digitaplatform/shared";
import { readBundle } from "@digitaplatform/shared/i18n-node";
import { getConfig } from "@/config/env";
import type { Locale } from "./config";

let translator: Translator | null = null;

/**
 * Chrome strings (the few fixed UI labels). The bulk of the site's text is CONTENT from the
 * engine; this only covers wrapper chrome: the folder digita-web of
 * digitaplatform/digita-translations, which the pod's init container puts in TRANSLATIONS_DIR.
 * Read on first use, like getConfig, so `next build` never needs it. A missing key falls back to
 * English.
 */
export function t(key: string, locale: Locale): string {
  translator ??= createTranslator(readBundle(getConfig().translationsDir), FALLBACK_LANGUAGE);
  return translator.t(key, undefined, locale);
}
