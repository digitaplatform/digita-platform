// The language menu offers, on one page, only the locales a visitor can land on.
import { describe, it, expect } from "vitest";
import { offeredLocales } from "../src/config/locales";
import { pathSlug } from "../src/lib/nav";

const served = ["en", "de", "fr"];
// en publishes home and privacy, de publishes only the home, fr is all drafts.
const published = { en: ["", "privacy"], de: [""] };

describe("offeredLocales", () => {
  it("PLANTED DEFECT: on a page published in one locale only, no other locale is offered, even one whose home is published", () => {
    // A site-level rule (de has a published home) would offer Deutsch here and send the visitor to a 404.
    expect(offeredLocales(served, published, [], "privacy", "en")).toEqual(["en"]);
  });

  it("offers every locale in which the page is published, and keeps the current one", () => {
    expect(offeredLocales(served, published, [], "", "en")).toEqual(["en", "de"]);
    expect(offeredLocales(served, published, [], "", "de")).toEqual(["en", "de"]);
    // The way back stays even where the current locale's page is not published.
    expect(offeredLocales(served, published, [], "privacy", "de")).toEqual(["en", "de"]);
  });

  it("PLANTED INNOCENT: the site's enabled list narrows, an empty one does not, the current locale always stays", () => {
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, ["en", "fr"], "", "en")).toEqual(["en", "fr"]);
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, [], "", "en")).toEqual(["en", "de", "fr"]);
    expect(offeredLocales(served, { en: [""], de: [""], fr: [""] }, ["en"], "", "de")).toEqual(["en", "de"]);
  });
});

describe("pathSlug", () => {
  it("names the page without its locale prefix, and the home as an empty slug", () => {
    expect(pathSlug("/", served)).toBe("");
    expect(pathSlug("/de", served)).toBe("");
    expect(pathSlug("/de/", served)).toBe("");
    expect(pathSlug("/privacy", served)).toBe("privacy");
    expect(pathSlug("/de/privacy", served)).toBe("privacy");
    expect(pathSlug("/de/docs/start", served)).toBe("docs/start");
  });
});
