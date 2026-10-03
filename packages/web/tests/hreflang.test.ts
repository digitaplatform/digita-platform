// The hreflang set names only the locales in which a page's translation group is published.
import { describe, it, expect, vi } from "vitest";
import type { WebPage } from "../src/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/engine-client", () => ({
  // The engine's public read answers published rows only; a draft sibling never reaches this list.
  listPages: async () => [
    { _id: "example::en::privacy", slug: "privacy", locale: "en", translation_group: "privacy" },
    { _id: "example::de::privacy", slug: "privacy", locale: "de", translation_group: "privacy" },
    { _id: "example::de::", slug: "", locale: "de", translation_group: "home" },
  ],
}));

Object.assign(process.env, {
  ENGINE_URL: "http://engine.internal:3000",
  VERSION_ENDPOINTS: "https://example.org/health",
  SITE_ID: "example",
  SITE_URL: "https://example.org",
  PUBLIC_ENGINE_URL: "",
  REVALIDATE_SECONDS: "60",
  REVALIDATE_SECRET: "test-revalidate-secret",
  TRANSLATIONS_DIR: "/translations",
  LOCALES: "en,de,fr",
  DEFAULT_LOCALE: "en",
});

const { buildPageMetadata } = await import("../src/lib/seo");

describe("buildPageMetadata", () => {
  it("PLANTED DEFECT: names only the published siblings in hreflang, never a served locale without one", async () => {
    const page = { _id: "example::en::privacy", slug: "privacy", locale: "en", translation_group: "privacy", title: "Privacy", status: "published" } as WebPage;
    const metadata = await buildPageMetadata(page, null);
    const languages = metadata.alternates?.languages as Record<string, string>;
    // A loop over the served locales would add fr here; this goes red then.
    expect(Object.keys(languages).sort()).toEqual(["de", "en", "x-default"]);
    expect(languages.de).toBe("https://example.org/de/privacy");
    expect(languages["x-default"]).toBe("https://example.org/privacy");
  });
});
