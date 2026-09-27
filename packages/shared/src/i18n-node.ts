import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUPPORTED_LANGUAGES, type LocaleBundle, type LocaleMessages } from "./i18n.js";

/**
 * Loads every supported language of one build's translations from `dir`, where the pod's init
 * container put its stage's pinned commit of digitaplatform/digita-translations. A missing,
 * unreadable or unparsable file throws, naming it. Its own subpath export keeps `node:fs` out of
 * browser bundles.
 */
export function readBundle(dir: string, languages: readonly string[] = SUPPORTED_LANGUAGES): LocaleBundle {
  const bundle: LocaleBundle = {};
  for (const language of languages) {
    const file = join(dir, `${language}.json`);
    const text = readFileSync(file, "utf8");
    try {
      bundle[language] = JSON.parse(text) as LocaleMessages;
    } catch (error) {
      throw new Error(`translations: ${file} is not valid JSON: ${(error as Error).message}`);
    }
  }
  return bundle;
}

const KEY_CALL = /\b(t|tPlural)\(\s*(["'`])([\w.-]+)\2/g;

/**
 * The keys that `t("…")` and `tPlural("…", …)` calls in the .ts and .tsx files under `dir` name
 * and `messages` lacks, each as "<file>:<line> <key>". A `tPlural` key needs `<key>.one` and
 * `<key>.other`. A key built at run time, such as a template literal with `${}`, is not seen.
 * Code and texts are versioned apart, so a build's tests run this against its folder of
 * digita-translations `master` to catch a key the code uses and the texts lack.
 */
export function findMissingKeys(dir: string, messages: LocaleMessages): string[] {
  const missing: string[] = [];
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
    .sort();
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const match of source.matchAll(KEY_CALL)) {
      const call = match[1];
      const key = match[3]!; // KEY_CALL's third group is not optional
      const keyStart = match.index + match[0].length - 1 - key.length;
      const line = source.slice(0, keyStart).split("\n").length;
      const needed = call === "tPlural" ? [`${key}.one`, `${key}.other`] : [key];
      for (const k of needed) {
        if (!Object.hasOwn(messages, k)) missing.push(`${file.replaceAll("\\", "/")}:${line} ${k}`);
      }
    }
  }
  return missing;
}
