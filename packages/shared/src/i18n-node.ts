import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LANGUAGES, type LocaleBundle, type LocaleMessages } from "./i18n.js";

/**
 * Loads every supported language of one build's translations from `dir`, where the pod's init
 * container put its stage's pinned commit of digitaplatform/digita-translations. A missing or
 * unreadable file throws, naming it. Its own subpath export keeps `node:fs` out of browser bundles.
 */
export function readBundle(dir: string, languages: readonly string[] = SUPPORTED_LANGUAGES): LocaleBundle {
  const bundle: LocaleBundle = {};
  for (const language of languages) {
    bundle[language] = JSON.parse(readFileSync(join(dir, `${language}.json`), "utf8")) as LocaleMessages;
  }
  return bundle;
}
