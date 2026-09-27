import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findMissingKeys, readBundle } from "@digitaplatform/shared/i18n-node";
import { getLocales } from "../src/config/locales";

// The site's chrome texts are the folder digita-web of digitaplatform/digita-translations, read
// from TRANSLATIONS_DIR as the pod reads them: never a copy kept here.
const translationsDir = process.env.TRANSLATIONS_DIR;
if (!translationsDir) {
  throw new Error("TRANSLATIONS_DIR is not set: point it at translations/digita-web of a digitaplatform/digita-translations checkout");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the website's texts", () => {
  // Code and texts are versioned apart: every literal key of a t() call must be in digita-web's
  // en.json. A key built at run time is not seen.
  it("carry every literal key of the code in en.json", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    expect(findMissingKeys(src, readBundle(translationsDir, ["en"]).en!)).toEqual([]);
  });
});

describe("LOCALES", () => {
  it("accepts the languages the texts carry", () => {
    vi.stubEnv("LOCALES", "de, en");
    expect(getLocales()).toEqual(["de", "en"]);
  });

  it("refuses a language the texts do not carry, naming it", () => {
    vi.stubEnv("LOCALES", "en,pt");
    expect(() => getLocales()).toThrow('[digita-web] LOCALES names pt, which the site\'s texts do not carry');
  });
});
