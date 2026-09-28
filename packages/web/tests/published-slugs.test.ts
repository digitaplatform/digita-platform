// The published pages per locale come from the engine's public read, keyed by locale.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de,fr",
  DEFAULT_LOCALE: "en",
});

const { listPublishedSlugs } = await import("../src/lib/engine-client");

afterEach(() => vi.unstubAllGlobals());

describe("listPublishedSlugs", () => {
  it("PLANTED DEFECT: keys every published page by its locale, including a locale without a home", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          data: [
            { _id: "example::en::", slug: "", locale: "en" },
            { _id: "example::en::privacy", slug: "privacy", locale: "en" },
            { _id: "example::de::", slug: "", locale: "de" },
            // fr has one published page and a draft home; a rule keyed on homes alone would drop it.
            { _id: "example::fr::contact", slug: "contact", locale: "fr" },
          ],
        }),
      ),
    );
    expect(await listPublishedSlugs()).toEqual({ en: ["", "privacy"], de: [""], fr: ["contact"] });
  });
});
