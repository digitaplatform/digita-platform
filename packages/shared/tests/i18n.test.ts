import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as shared from "../src/index.js";
import { createTranslator, fetchBundle, SUPPORTED_LANGUAGES } from "../src/i18n.js";
import { findMissingKeys, readBundle } from "../src/i18n-node.js";

const i18n = createTranslator(
  {
    en: { greeting: "Hello {name}", "codes.one": "{count} code left", "codes.other": "{count} codes left" },
    de: { greeting: "Hallo {name}", "codes.one": "{count} Code übrig", "codes.other": "{count} Codes übrig" },
  },
  "en",
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the translator", () => {
  it("reads the asked language, falls back to en, and returns an unknown key as itself", () => {
    expect(i18n.t("greeting", { name: "Ada" }, "de")).toBe("Hallo Ada");
    expect(i18n.t("greeting", { name: "Ada" }, "fr")).toBe("Hello Ada");
    expect(i18n.t("no.such.key", undefined, "de")).toBe("no.such.key");
  });

  it("picks the plural form by the language's rules and fills {count}", () => {
    expect(i18n.tPlural("codes", 1, undefined, "en")).toBe("1 code left");
    expect(i18n.tPlural("codes", 2, undefined, "en")).toBe("2 codes left");
    expect(i18n.tPlural("codes", 1, undefined, "de")).toBe("1 Code übrig");
    expect(i18n.tPlural("codes", 0, undefined, "de")).toBe("0 Codes übrig");
    expect(i18n.tPlural("codes", 1, undefined, "ja")).toBe("1 code left");
  });

  it("resolves Accept-Language by quality", () => {
    expect(i18n.resolveLocale("en;q=0.8,de;q=0.9")).toBe("de");
    expect(i18n.resolveLocale("de;q=0,en;q=0.5")).toBe("en");
  });
});

describe("the loaders of digita-translations", () => {
  it("fetches every supported language from the base URL", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ title: url }), { status: 200 });
    });
    const bundle = await fetchBundle("/auth/translations/");
    expect(Object.keys(bundle)).toEqual([...SUPPORTED_LANGUAGES]);
    expect(urls).toContain("/auth/translations/tr.json");
  });

  it("fails the fetch when a language file is not delivered, naming it", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("it.json") ? new Response("", { status: 404 }) : new Response("{}", { status: 200 }),
    );
    await expect(fetchBundle("/t/")).rejects.toThrow("translations: /t/it.json answered 404");
  });

  it("reads every supported language from a directory, and throws on a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "translations-"));
    for (const language of SUPPORTED_LANGUAGES) writeFileSync(join(dir, `${language}.json`), `{"title":"${language}"}`);
    expect(readBundle(dir).tr).toEqual({ title: "tr" });
    const partial = mkdtempSync(join(tmpdir(), "translations-"));
    writeFileSync(join(partial, "en.json"), "{}");
    expect(() => readBundle(partial)).toThrow(/de\.json/);
    const truncated = mkdtempSync(join(tmpdir(), "translations-"));
    writeFileSync(join(truncated, "en.json"), `{"title":`);
    expect(() => readBundle(truncated, ["en"])).toThrow(/en\.json is not valid JSON/);
  });

  it("keeps the Node loader out of the root export, so a browser bundle never pulls in node:fs", () => {
    expect("readBundle" in shared).toBe(false);
    expect("findMissingKeys" in shared).toBe(false);
    expect(typeof shared.fetchBundle).toBe("function");
  });
});

describe("the key-drift guard", () => {
  it("names each literal key the code uses and the texts lack, with its file and line", () => {
    const dir = mkdtempSync(join(tmpdir(), "src-"));
    mkdirSync(join(dir, "pages"));
    writeFileSync(join(dir, "a.ts"), `i18n.t("known");\nformat("not.a.key");\nt(\`dynamic.\${x}\`);\n`);
    writeFileSync(
      join(dir, "pages", "b.tsx"),
      `const x = t(\n  'missing.key',\n);\ntPlural('codes', n);\ntPlural("known", 2);\n`,
    );
    writeFileSync(join(dir, "c.d.ts"), `t("ignored.in.declarations");\n`);
    const messages = { known: "Known", "known.one": "one", "known.other": "other", "codes.one": "{count} code" };
    expect(findMissingKeys(dir, messages)).toEqual(["pages/b.tsx:2 missing.key", "pages/b.tsx:4 codes.other"]);
  });

  it("finds nothing when every key is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "src-"));
    writeFileSync(join(dir, "a.tsx"), `t('known'); tPlural('codes', 1);\n`);
    expect(findMissingKeys(dir, { known: "K", "codes.one": "1", "codes.other": "n" })).toEqual([]);
  });

  it("reads the one-message call a build names in place of t", () => {
    const dir = mkdtempSync(join(tmpdir(), "src-"));
    writeFileSync(join(dir, "a.tsx"), `tc('known'); tc("gone"); t('other.catalog'); tPlural('codes', 2);\n`);
    expect(findMissingKeys(dir, { known: "K" }, ["tc"])).toEqual(["a.tsx:1 gone", "a.tsx:1 codes.one", "a.tsx:1 codes.other"]);
  });
});
